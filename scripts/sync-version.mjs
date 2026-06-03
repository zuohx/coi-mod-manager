/**
 * sync-version.mjs
 *
 * 读取 package.json 中的 version，同步写入：
 *   - src-tauri/tauri.conf.json  → "version" 字段
 *   - src-tauri/Cargo.toml       → [package] version 字段
 *
 * 用法：node scripts/sync-version.mjs
 * 当版本号一致时不写文件，避免无谓的磁盘 IO 与文件时间戳变化。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')

// ── 1. 读取 package.json version ──────────────────────────────────────────────
const pkgPath = path.join(rootDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const version = pkg.version
if (!version) {
  console.error('[sync-version] package.json 中缺少 version 字段，终止同步。')
  process.exit(1)
}
console.log(`[sync-version] package.json version = ${version}`)

// ── 2. 同步 tauri.conf.json ───────────────────────────────────────────────────
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))

if (tauriConf.version !== version) {
  tauriConf.version = version
  // 保持 2 空格缩进，末尾换行
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8')
  console.log(`[sync-version] tauri.conf.json  → ${version}  ✓ 已更新`)
} else {
  console.log(`[sync-version] tauri.conf.json  → ${version}  (已是最新)`)
}

// ── 3. 同步 Cargo.toml ────────────────────────────────────────────────────────
const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml')
let cargoText = readFileSync(cargoPath, 'utf8')

// 仅替换 [package] 段下的 version = "x.y.z"，不影响依赖版本
const cargoVersionRegex = /^(\[package\][\s\S]*?^version\s*=\s*)"([^"]*)"/m
const cargoMatch = cargoText.match(cargoVersionRegex)

if (!cargoMatch) {
  console.warn('[sync-version] 警告：无法在 Cargo.toml 的 [package] 段找到 version 字段，跳过。')
} else {
  const currentCargoVersion = cargoMatch[2]
  if (currentCargoVersion !== version) {
    cargoText = cargoText.replace(cargoVersionRegex, `$1"${version}"`)
    writeFileSync(cargoPath, cargoText, 'utf8')
    console.log(`[sync-version] Cargo.toml       → ${version}  ✓ 已更新`)
  } else {
    console.log(`[sync-version] Cargo.toml       → ${version}  (已是最新)`)
  }
}

console.log('[sync-version] 同步完成。')
