import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string
}

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __LOCAL_AI_CORE_BASE__: JSON.stringify(process.env.VITE_LOCAL_AI_CORE_BASE || ''),
    __APP_VERSION__: JSON.stringify(packageJson.version || '0.0.0'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
