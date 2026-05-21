import { copyFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const tauriDir = join(projectRoot, 'src-tauri')
const sources = [
  { src: join(projectRoot, 'resources', 'node.exe'), dest: join(tauriDir, 'resources', 'node.exe') },
  {
    src: join(projectRoot, 'dist-server', 'server.mjs'),
    dest: join(tauriDir, 'dist-server', 'server.mjs'),
  },
]

let ok = 0
let fail = 0

for (const { src, dest } of sources) {
  if (!existsSync(src)) {
    console.warn(`  ⚠️  跳过（源文件不存在）: ${src}`)
    fail++
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  const size = statSync(src).size
  const sizeMB = (size / 1024 / 1024).toFixed(1)
  console.log(`  ✅ ${dest.replace(projectRoot + '\\', '')}  (${sizeMB} MB)`)
  ok++
}

if (fail > 0) {
  process.exitCode = 1
}
