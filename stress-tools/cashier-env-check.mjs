import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(root, 'cashier/.deploy/wrangler.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
assert.deepEqual(Object.keys(config.vars).sort(), ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL'])
for (const value of Object.values(config.vars)) assert.ok(typeof value === 'string' && value.trim())
await access(resolve(dirname(configPath), config.main))
await access(resolve(dirname(configPath), config.assets.directory, 'index.html'))

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(
  ts.transpile(source, { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }),
).toString('base64')
const apiUrl = asModule(await readFile(resolve(root, 'cashier/functions/api/cashier.ts'), 'utf8'))
const source = (await readFile(resolve(root, 'cashier/worker.ts'), 'utf8'))
  .replace('"./functions/api/cashier"', JSON.stringify(apiUrl))
const { default: worker } = await import(asModule(source))
const request = body => new Request('https://cashier.example/api/cashier', {
  method: 'POST',
  headers: { Origin: 'https://cashier.example', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const missing = await worker.fetch(request({ action: 'device' }), {})
assert.equal(missing.status, 503)
assert.deepEqual((await missing.json()).missing.sort(), Object.keys(config.vars).sort())
const configured = await worker.fetch(request({ action: 'device' }), config.vars)
assert.equal(configured.status, 401, 'Configured Worker must reach device authorization')

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${config.vars.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/redeem-terminal-pairing-code`)
    assert.equal(options.headers.apikey, config.vars.VITE_SUPABASE_PUBLISHABLE_KEY)
    return Response.json({ error: 'test upstream response' }, { status: 400 })
  }
  const upstream = await worker.fetch(request({ action: 'pairing', code: '1234567', name: 'Test' }), config.vars)
  assert.equal(upstream.status, 400)
  assert.equal((await upstream.json()).error, 'test upstream response')
} finally {
  globalThis.fetch = originalFetch
}
console.log('OK: deployment paths, runtime bindings, missing-config response, device authorization and Supabase forwarding')
