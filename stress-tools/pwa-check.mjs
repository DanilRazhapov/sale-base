import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../cashier/dist/', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');
const handlers = {};
const stores = new Map([['salebase-shell-old', new Map()], ['unrelated', new Map()]]);
let network = true;
let requests = 0;
const fetch = async request => {
    requests++;
    if (!network) throw new Error('Offline');
    const path = typeof request === 'string' ? request : request.url;
    return new Response(await readFile(new URL(path.replace(/^https:\/\/sale.test\//, '').replace(/^\//, ''), root)));
};
const caches = {
    keys: async () => [...stores.keys()],
    delete: async key => stores.delete(key),
    open: async key => {
        if (!stores.has(key)) stores.set(key, new Map());
        const store = stores.get(key);
        return {
            addAll: async assets => {
                for (const asset of assets) store.set(asset.url, await fetch(asset));
            },
            match: async path => store.get(`https://sale.test${path}`)?.clone(),
        };
    },
};
class LocalRequest extends Request {
    constructor(path, options) { super(new URL(path, 'https://sale.test'), options); }
}
vm.runInNewContext(source, {
    caches, fetch, Request: LocalRequest, URL,
    self: { location: { origin: 'https://sale.test' }, clients: { claim: async () => {} },
        addEventListener: (name, callback) => { handlers[name] = callback; } },
});
let pending;
handlers.install({ waitUntil: promise => { pending = promise; } });
await pending;
assert(!source.includes('self.skipWaiting('), 'Updates must wait for open clients');
handlers.activate({ waitUntil: promise => { pending = promise; } });
await pending;
assert(!stores.has('salebase-shell-old'));
assert(stores.has('unrelated'));
network = false;
for (const path of ['/login', '/login/cashier', '/cashier']) {
    let response;
    handlers.fetch({ request: { method: 'GET', url: `https://sale.test${path}`, mode: 'navigate' },
        respondWith: promise => { response = promise; } });
    assert.match(await (await response).text(), /id="root"/);
}
const shell = [...stores.values()].find(store => [...store.keys()].some(key => key.includes('/assets/')));
for (const url of shell.keys()) {
    let response;
    handlers.fetch({ request: { method: 'GET', url, mode: 'cors' }, respondWith: promise => { response = promise; } });
    assert.equal((await response).status, 200);
}
for (const request of [
    { method: 'POST', url: 'https://sale.test/checkout' },
    { method: 'GET', url: 'https://project.supabase.co/rest/v1/products' },
    { method: 'GET', url: 'https://sale.test/api/private' },
]) {
    handlers.fetch({ request, respondWith: () => assert.fail('API request intercepted') });
}
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/login');
assert.equal(manifest.scope, '/');
for (const icon of manifest.icons) {
    const png = await readFile(new URL(icon.src.slice(1), root));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
}
assert(requests > 0);
console.log('PWA checks passed: precache, offline routes/assets, update lifecycle, API exclusion, icon dimensions.');
