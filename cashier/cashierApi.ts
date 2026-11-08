import { Readable } from 'node:stream'
import { loadEnv, type Connect, type Plugin } from 'vite'
import { onRequest } from './functions/api/cashier.js'

export function cashierApi(): Plugin {
  let env: Record<string, string>

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/cashier') return next()
    try {
      const headers = new Headers()
      for (const [name, values] of Object.entries(req.headersDistinct)) {
        for (const value of values ?? []) headers.append(name, value)
      }
      const request = new Request(`http://${headers.get('host')}/api/cashier`, {
        method: req.method,
        headers,
        ...(req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' as const } : {}),
      })
      const response = await onRequest({ request, env })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      next(error)
    }
  }

  return {
    name: 'salebase-cashier-api',
    configResolved(config) { env = loadEnv(config.mode, config.envDir, 'VITE_') },
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
