import { copyFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const releaseDir = join(projectRoot, 'src-tauri', 'target', 'release')

function copyResource(src, relPath) {
  const dest = join(releaseDir, relPath)
  if (!existsSync(src)) {
    console.warn(`  ⚠️  源文件不存在: ${src}`)
    return false
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  const size = statSync(src).size
  const sizeMB = (size / 1024 / 1024).toFixed(1)
  console.log(`  ✅ ${relPath}  (${sizeMB} MB)`)
  return true
}

function main() {
  console.log('')
  console.log('  Copying bundled resources to release directory...')
  console.log('')

  const resources = [
    { src: join(projectRoot, 'resources', 'node.exe'), dest: join('resources', 'node.exe') },
    { src: join(projectRoot, 'dist-server', 'server.mjs'), dest: join('dist-server', 'server.mjs') },
  ]

  let copied = 0
  let failed = 0
  for (const { src, dest } of resources) {
    if (copyResource(src, dest)) {
      copied++
    } else {
      failed++
    }
  }

  console.log('')

  if (failed === 0 && copied > 0) {
    console.log(`  ✅ 资源复制完成。现在可以直接运行构建后的 exe：`)
    console.log(`     ${join(releaseDir, 'coi-mod-manager.exe')}`)
  } else if (failed > 0) {
    console.log(`  ⚠️  复制完成 ${copied}/${copied + failed}，${failed} 个资源缺失。`)
    console.log('     请确保先运行 pnpm build:server 且 resources/node.exe 已就位。')
  }
  console.log('')
}

main()
