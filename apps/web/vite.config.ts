import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'fs'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version?: string
}

export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  plugins: [react()],
  define: {
    __LOCAL_AI_CORE_BASE__: JSON.stringify(process.env.VITE_LOCAL_AI_CORE_BASE || ''),
    __AGENTDOCK_DAEMON_BASE__: JSON.stringify(process.env.VITE_AGENTDOCK_DAEMON_BASE || process.env.VITE_LOCAL_AI_CORE_BASE || ''),
    __APP_VERSION__: JSON.stringify(packageJson.version || '0.0.0'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@agentdock/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      '@agentdock/sdk': path.resolve(__dirname, '../../packages/sdk/src'),
      '@agentdock/plugin-sdk': path.resolve(__dirname, '../../packages/plugin-sdk/src'),
      '@agentdock/knowledge': path.resolve(__dirname, '../../packages/knowledge/src'),
      '@cc/superai-contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      '@cc/core-sdk': path.resolve(__dirname, '../../packages/sdk/src'),
      '@cc/plugin-sdk': path.resolve(__dirname, '../../packages/plugin-sdk/src'),
      '@cc/knowledge-api': path.resolve(__dirname, '../../packages/knowledge/src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
