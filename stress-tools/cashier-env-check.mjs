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
    assert.equal(options.redirect, 'manual', 'Cloudflare Workers supports only follow/manual redirects')
    assert.equal(url, `${config.vars.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/redeem-terminal-pairing-code`)
    assert.equal(options.headers.apikey, config.vars.VITE_SUPABASE_PUBLISHABLE_KEY)
    return Response.json({ error: 'test upstream response' }, { status: 400 })
  }
  const upstream = await worker.fetch(request({ action: 'pairing', code: '1234567', name: 'Test' }), config.vars)
  assert.equal(upstream.status, 400)
  assert.equal((await upstream.json()).error, 'test upstream response')

  let redirectCalls = 0
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'manual')
    redirectCalls++
    return new Response(null, { status: 307, headers: { Location: 'https://other.example/' } })
  }
  for (const body of [{ action: 'pairing', code: '1234567', name: 'Test' }, { action: 'device' }]) {
    const req = request(body)
    req.headers.set('Cookie', '__Secure-salebase_device=' + 'a'.repeat(64))
    const response = await worker.fetch(req, config.vars)
    assert.equal(response.status, 502)
    const result = await response.json()
    assert.equal(result.code, 'CASHIER_UPSTREAM_REDIRECT')
    assert.equal(result.upstream_status, 307)
  }
  assert.equal(redirectCalls, 2, 'Redirects must not trigger another request with credentials')

  for (const [mock, code, status] of [
    [async () => { throw new TypeError('fetch failed') }, 'CASHIER_UPSTREAM_FETCH_FAILED', 502],
    [async () => { throw new DOMException('timeout', 'TimeoutError') }, 'CASHIER_UPSTREAM_TIMEOUT', 504],
    [async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), 'CASHIER_UPSTREAM_INVALID_JSON', 502],
  ]) {
    globalThis.fetch = mock
    for (const body of [{ action: 'pairing', code: '1234567', name: 'Test' }, { action: 'device' }]) {
      const req = request(body)
      req.headers.set('Cookie', '__Secure-salebase_device=' + 'a'.repeat(64))
      const response = await worker.fetch(req, config.vars)
      assert.equal(response.status, status)
      const result = await response.json()
      assert.equal(result.code, code)
      if (code === 'CASHIER_UPSTREAM_INVALID_JSON') {
        assert.equal(result.upstream_status, 502)
        assert.equal(result.content_type, 'text/html')
      }
      assert.ok(!JSON.stringify(result).includes(config.vars.VITE_SUPABASE_PUBLISHABLE_KEY))
    }
  }
} finally {
  globalThis.fetch = originalFetch
}
console.log('OK: deployment paths, runtime bindings, device authorization, Supabase forwarding and network/timeout/non-JSON diagnostics')
