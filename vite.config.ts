import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { createModApiPlugin } from './server/mod-api.ts'

const host = process.env.TAURI_DEV_HOST
const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: rootDir,
  clearScreen: false,
  plugins: [react(), createModApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src')
    }
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  }
})
