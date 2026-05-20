import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')

await build({
  absWorkingDir: rootDir,
  entryPoints: [path.join(rootDir, 'server', 'standalone.ts')],
  outfile: path.join(rootDir, 'dist-server', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['vite'],
})
