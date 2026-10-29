import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (command === 'build') {
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
      .filter((name) => !env[name]?.trim())
    if (missing.length) {
      throw new Error(`Missing build environment variables: ${missing.join(', ')}. Configure them in Cloudflare Pages or .env.local.`)
    }
  }
  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
  }
})
