import { createFrontendConfig } from '../vite.config.js'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { ownerDeployConfig } from './deployConfig.js'

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
