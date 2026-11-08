import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const frontendDir = fileURLToPath(new URL('.', import.meta.url))

export function createFrontendConfig(app: 'owner' | 'cashier', port: number, appPlugins: Plugin[] = []) {
  return defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, frontendDir, 'VITE_')
    const ownerUrl = env.VITE_OWNER_APP_URL?.trim()
    if (app === 'cashier' && ownerUrl) {
      const origin = new URL(ownerUrl).origin
      if (!/^https?:\/\//i.test(ownerUrl) || (ownerUrl !== origin && ownerUrl !== origin + '/')) {
        throw new Error('VITE_OWNER_APP_URL must be the public HTTP(S) origin of the owner app.')
      }
    }
    if (command === 'build') {
      const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
        .filter((name) => !env[name]?.trim())
      if (missing.length) {
        throw new Error(`Missing build environment variables: ${missing.join(', ')}. Configure them in Cloudflare Pages or frontend/.env.local.`)
      }
    }
    return {
      root: resolve(frontendDir, app),
      envDir: frontendDir,
      cacheDir: resolve(frontendDir, 'node_modules/.vite', app),
      server: { port, strictPort: true },
      preview: { port: port + 1000, strictPort: true },
      plugins: [
        ...appPlugins,
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
      ],
    }
  })
}
