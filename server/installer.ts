import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ensureHubCookies, normalizeHubPageUrl } from './hub'
import { downloadArchive } from './downloader'
import { ensurePathInside, getDefaultModsDir, locateExtractedModRoot, readSingleMod, resolveDownloadUrl, enrichMod } from './mods'
import { pathExists } from './util'
import type { ScanResponse, UpgradeProgress, UpgradeRequest } from './types'

const execFileAsync = promisify(execFile)

async function extractArchive(zipPath: string, destinationPath: string) {
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destinationPath], {
      windowsHide: true,
    })
    return
  } catch {
    // tar not available or failed, fallback to PowerShell
  }

  const escapedZip = zipPath.replace(/'/g, "''")
  const escapedDest = destinationPath.replace(/'/g, "''")
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force`,
    ],
    {
      windowsHide: true,
    }
  )
}

export async function upgradeMod(
  body: UpgradeRequest,
  onProgress?: (progress: UpgradeProgress) => void
): Promise<ScanResponse> {
  const dirPath = getDefaultModsDir()
  const installDir = body.installDir ? path.resolve(body.installDir) : ''
  const downloadSource = body.downloadUrl?.trim() ?? ''

  if (!installDir || !downloadSource) {
    throw new Error('Missing installDir or downloadUrl')
  }

  ensurePathInside(dirPath, installDir)

  const hubPageUrl = normalizeHubPageUrl(body.hubPageUrl?.trim() || downloadSource)
  await ensureHubCookies(true, hubPageUrl)

  onProgress?.({
    phase: 'resolving',
    message: '正在解析下载地址',
    percent: 5,
  })
  const downloadUrl = await resolveDownloadUrl(downloadSource, hubPageUrl)

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coi-mod-upgrade-'))
  const zipPath = path.join(tempRoot, 'mod.zip')
  const extractDir = path.join(tempRoot, 'extract')
  const backupDir = `${installDir}.backup-${Date.now()}`

  try {
    await downloadArchive(downloadUrl, zipPath, onProgress, hubPageUrl)

    onProgress?.({
      phase: 'extracting',
      message: `正在解压安装包到: ${extractDir}`,
      percent: 76,
    })
    await fs.mkdir(extractDir, { recursive: true })
    await extractArchive(zipPath, extractDir)

    const extractedModRoot = await locateExtractedModRoot(extractDir)
    if (!extractedModRoot) {
      throw new Error('Downloaded archive does not contain manifest.json')
    }

    onProgress?.({
      phase: 'installing',
      message: `正在安装到 Mod 目录: ${installDir}`,
      percent: 88,
    })

    const savedSettingsDir = path.join(installDir, 'Saved Settings')
    const savedSettingsBackup = path.join(tempRoot, 'saved-settings-backup')
    const hasSavedSettings = await pathExists(savedSettingsDir)

    const zhJsonPath = path.join(installDir, 'translations', 'zh.json')
    const zhJsonBackup = path.join(tempRoot, 'zh.json')
    const hasZhJson = await pathExists(zhJsonPath)

    if (hasSavedSettings) {
      await fs.cp(savedSettingsDir, savedSettingsBackup, { recursive: true })
    }

    if (hasZhJson) {
      await fs.cp(zhJsonPath, zhJsonBackup)
    }

    if (await pathExists(installDir)) {
      await fs.rename(installDir, backupDir)
    }

    try {
      await fs.mkdir(installDir, { recursive: true })
      await fs.cp(extractedModRoot, installDir, { recursive: true, force: true })

      if (hasSavedSettings) {
        const restoredDir = path.join(installDir, 'Saved Settings')
        await fs.mkdir(restoredDir, { recursive: true })
        await fs.cp(savedSettingsBackup, restoredDir, { recursive: true, force: true })
      }

      const newZhJsonPath = path.join(installDir, 'translations', 'zh.json')
      const hasNewZhJson = await pathExists(newZhJsonPath)
      if (hasZhJson && !hasNewZhJson) {
        const restoredZhPath = path.join(installDir, 'translations', 'zh.json')
        await fs.mkdir(path.dirname(restoredZhPath), { recursive: true })
        await fs.cp(zhJsonBackup, restoredZhPath)
      }

      if (await pathExists(backupDir)) {
        await fs.rm(backupDir, { recursive: true, force: true })
      }
    } catch (error) {
      await fs.rm(installDir, { recursive: true, force: true })
      if (await pathExists(backupDir)) {
        await fs.rename(backupDir, installDir)
      }
      throw error
    }

    onProgress?.({
      phase: 'scanning',
      message: '正在读取 Mod 信息',
      percent: 96,
    })
    const localMod = await readSingleMod(installDir)
    onProgress?.({
      phase: 'completed',
      message: '升级完成',
      percent: 100,
    })

    const dirPath = getDefaultModsDir()
    if (!localMod) {
      return { dirPath, mods: [] }
    }

    const enriched = await enrichMod(localMod, true)
    return { dirPath, mods: [enriched] }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}
