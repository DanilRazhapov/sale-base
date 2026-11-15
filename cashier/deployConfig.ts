import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnv, type Plugin } from 'vite'

// Vite build variables are not automatically runtime bindings in Workers.
// Package the two public Supabase settings alongside the Worker deployment.
export function cashierDeployConfig(): Plugin {
  let root: string
  let vars: Record<string, string>

  return {
    name: 'salebase-cashier-deploy-config',
    apply: 'build',
    configResolved(config) {
      root = config.root
      const env = loadEnv(config.mode, config.envDir, 'VITE_')
      vars = Object.fromEntries(
        ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].map(name => {
          const value = env[name]?.trim()
          if (!value) throw new Error(`Missing Worker deployment setting: ${name}`)
          return [name, value]
        }),
      )
    },
    async closeBundle() {
      const source = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'))
      const directory = resolve(root, '.deploy')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify({
        ...source,
        main: '../worker.ts',
        assets: { ...source.assets, directory: '../dist' },
        vars: { ...source.vars, ...vars },
      }, null, 2) + '\n')
    },
  }
}
