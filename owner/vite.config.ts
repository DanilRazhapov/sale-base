import { createFrontendConfig } from '../vite.config.js'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Include public Supabase settings in the Worker's runtime deployment bindings.
function ownerDeployConfig(): Plugin {
  let root: string
  let vars: Record<string, string>

  return {
    name: 'salebase-owner-deploy-config',
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

const frontendDir = fileURLToPath(new URL('..', import.meta.url))
const ownerConfig = createFrontendConfig('owner', 5174, [ownerDeployConfig()])

export default defineConfig(configEnv => {
  const config = ownerConfig(configEnv)
  const env = loadEnv(configEnv.mode, frontendDir, 'VITE_')
  // Keep the production build layout; run the actual Worker during development.
  const workerPlugins = configEnv.command === 'serve' && !configEnv.isPreview
    ? cloudflare({
        configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)),
        inspectorPort: false,
        config: {
          vars: Object.fromEntries(
            ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
              .filter(name => env[name]?.trim())
              .map(name => [name, env[name].trim()]),
          ),
        },
      })
    : []
  return { ...config, plugins: [...(config.plugins ?? []), ...workerPlugins] }
})
