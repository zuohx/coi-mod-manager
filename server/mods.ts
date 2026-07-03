import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  DOWNLOAD_URL_PREFIX,
  HUB_BASE,
  fetchLatestDownloadUrl,
  fetchModDetailInfo,
  normalizeHubPageUrl,
  searchHub,
} from './hub'
import { normalizeName, pathExists, uniqueBy } from './util'
import type { ApiModRecord, HubListing, LocalMod, ModStatus, ScanResponse } from './types'

export function getDefaultModsDir(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'Captain of Industry', 'Mods')
}

export function ensurePathInside(parentDir: string, childPath: string) {
  const resolvedParent = path.resolve(parentDir)
  const resolvedChild = path.resolve(childPath)
  const withSeparator = resolvedParent.endsWith(path.sep) ? resolvedParent : `${resolvedParent}${path.sep}`

  if (!resolvedChild.startsWith(withSeparator)) {
    throw new Error('Path escapes default Mods directory')
  }
}

export async function readDirectoryEntries(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

export async function findManifestPath(dirPath: string): Promise<string | null> {
  const exactPath = path.join(dirPath, 'manifest.json')
  if (await pathExists(exactPath)) {
    return exactPath
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const manifestEntry = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === 'manifest.json'
  )

  return manifestEntry ? path.join(dirPath, manifestEntry.name) : null
}

export async function locateExtractedModRoot(rootDir: string): Promise<string | null> {
  const queue = [rootDir]
  let bestMatch: string | null = null
  let bestDepth = Number.POSITIVE_INFINITY

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    const entries = await fs.readdir(current, { withFileTypes: true })
    const manifest = entries.find((entry) => entry.isFile() && entry.name === 'manifest.json')
    if (manifest) {
      const relative = path.relative(rootDir, current)
      const depth = relative ? relative.split(path.sep).length : 0
      if (depth < bestDepth) {
        bestDepth = depth
        bestMatch = current
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name))
      }
    }
  }

  return bestMatch
}

export async function readSingleMod(installDir: string): Promise<LocalMod | null> {
  const manifestPath = await findManifestPath(installDir)
  if (!manifestPath) return null

  try {
    const manifestText = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(manifestText)
    const displayName = getManifestDisplayName(parsed)
    const authors = getManifestAuthors(parsed)

    if (typeof parsed.id === 'string' && typeof parsed.version === 'string') {
      return {
        id: parsed.id,
        version: parsed.version,
        displayName: displayName ?? parsed.id,
        sizeText: '-',
        authors,
        manifestPath,
        installDir,
        hubUrl: getManifestUrl(parsed, ['hubUrl', '_hubUrl']),
        hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion']),
      }
    }
  } catch {
    // Invalid manifest
  }

  return null
}

export async function collectLocalMods(dirPath: string): Promise<LocalMod[]> {
  const mods: LocalMod[] = []
  const visited = new Set<string>()

  async function walk(currentDir: string): Promise<void> {
    const normalized = path.resolve(currentDir)
    if (visited.has(normalized)) return
    visited.add(normalized)

    const manifestPath = await findManifestPath(currentDir)
    if (manifestPath) {
      try {
        const manifestText = await fs.readFile(manifestPath, 'utf8')
        const parsed = JSON.parse(manifestText)
        const displayName = getManifestDisplayName(parsed)
        const authors = getManifestAuthors(parsed)

        if (typeof parsed.id === 'string' && typeof parsed.version === 'string') {
          mods.push({
            id: parsed.id,
            version: parsed.version,
            displayName: displayName ?? parsed.id,
            sizeText: '-',
            authors,
            manifestPath,
            installDir: currentDir,
            hubUrl: getManifestUrl(parsed, ['hubUrl', '_hubUrl']),
            hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion']),
          })
        }
      } catch {
        // Ignore invalid manifests. Remaining mods still load.
      }
    }

    const children = await readDirectoryEntries(currentDir)
    for (const child of children) {
      await walk(path.join(currentDir, child))
    }
  }

  await walk(dirPath)
  return mods
}

export function getManifestDisplayName(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.displayName === 'string' && record.displayName.trim()) {
    return record.displayName.trim()
  }

  if (typeof record.display_name === 'string' && record.display_name.trim()) {
    return record.display_name.trim()
  }

  return null
}

export function getManifestAuthors(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') {
    return []
  }

  const record = parsed as Record<string, unknown>
  const authors = record.authors

  if (Array.isArray(authors)) {
    return authors
      .filter((author): author is string => typeof author === 'string')
      .map((author) => author.trim())
      .filter(Boolean)
  }

  if (typeof authors === 'string' && authors.trim()) {
    return [authors.trim()]
  }

  return []
}

export function getManifestUrl(parsed: unknown, keys: string[]): string | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }

  const record = parsed as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

export function normalizeRemoteVersion(value?: string): string | undefined {
  if (!value) {
    return undefined
  }

  return value.replace(/^v/i, '').trim() || undefined
}

export function computeStatus(localVersion: string, remoteVersion?: string): ModStatus {
  if (!remoteVersion) {
    return 'unknown'
  }

  return compareVersions(localVersion, remoteVersion) >= 0 ? 'up_to_date' : 'update_available'
}

export function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment.replace(/[^\d].*$/, ''), 10) || 0)
}

export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  const maxLength = Math.max(parsedLeft.length, parsedRight.length)

  for (let index = 0; index < maxLength; index += 1) {
    const currentLeft = parsedLeft[index] ?? 0
    const currentRight = parsedRight[index] ?? 0
    if (currentLeft > currentRight) return 1
    if (currentLeft < currentRight) return -1
  }

  return 0
}

export function toPendingMod(localMod: LocalMod): ApiModRecord {
  const cachedHubVersion = normalizeRemoteVersion(localMod.hubVersion)
  const cachedHubUrl = localMod.hubUrl?.trim()

  return {
    id: localMod.id,
    displayName: localMod.displayName,
    version: localMod.version,
    sizeText: '-',
    sizeLoading: true,
    remoteVersion: cachedHubVersion,
    url: cachedHubUrl,
    status: cachedHubVersion ? computeStatus(localMod.version, cachedHubVersion) : 'unknown',
    manifestPath: localMod.manifestPath,
    installDir: localMod.installDir,
  }
}

export function finalizeModRecord(record: ApiModRecord): ApiModRecord {
  return {
    ...record,
    sizeLoading: false,
  }
}

export function sortModRecords(mods: ApiModRecord[]): ApiModRecord[] {
  return [...mods].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
  )
}

export function sortScanResponse(dirPath: string, mods: ApiModRecord[]): ScanResponse {
  return {
    dirPath,
    mods: sortModRecords(mods),
  }
}

async function applyHubDetail(record: ApiModRecord, modUrl?: string, forceRefresh = false): Promise<ApiModRecord> {
  if (!modUrl?.startsWith(`${HUB_BASE}/Mod/`)) {
    return record
  }

  try {
    const detail = await fetchModDetailInfo(modUrl, forceRefresh)
    return {
      ...record,
      sizeText: detail.sizeText ?? record.sizeText,
      downloadUrl: detail.downloadUrl ?? record.downloadUrl,
      changelogEntries: detail.changelog,
    }
  } catch {
    return record
  }
}

export async function enrichMod(localMod: LocalMod, forceRefresh = false): Promise<ApiModRecord> {
  const base: ApiModRecord = {
    id: localMod.id,
    displayName: localMod.displayName,
    version: localMod.version,
    sizeText: localMod.sizeText,
    manifestPath: localMod.manifestPath,
    installDir: localMod.installDir,
    status: 'unknown',
  }

  try {
    const cachedHubVersion = normalizeRemoteVersion(localMod.hubVersion)
    const cachedHubUrl = localMod.hubUrl?.trim()

    if (cachedHubVersion) {
      return finalizeModRecord(
        await applyHubDetail(
          {
            ...base,
            remoteVersion: cachedHubVersion,
            url: cachedHubUrl,
            status: computeStatus(localMod.version, cachedHubVersion),
          },
          cachedHubUrl,
          forceRefresh
        )
      )
    }

    const hubListing = await findHubListing(localMod)
    if (!hubListing) {
      return finalizeModRecord(base)
    }

    return finalizeModRecord(
      await applyHubDetail(
        {
          ...base,
          remoteVersion: hubListing.version,
          url: hubListing.url,
          status: computeStatus(localMod.version, hubListing.version),
        },
        hubListing.url,
        forceRefresh
      )
    )
  } catch {
    return finalizeModRecord(base)
  }
}

async function findHubListing(localMod: LocalMod): Promise<HubListing | null> {
  const queries = uniqueBy(
    [localMod.displayName, localMod.id, path.basename(localMod.installDir)],
    (value) => normalizeName(value)
  )

  const targetNames = [localMod.displayName, localMod.id, path.basename(localMod.installDir)]
    .map(normalizeName)
    .filter(Boolean)

  function findExact(listings: HubListing[]): HubListing | undefined {
    return listings.find((listing) => targetNames.includes(normalizeName(listing.title)))
  }

  function findPartial(listings: HubListing[]): HubListing | undefined {
    return listings.find((listing) => {
      const normalized = normalizeName(listing.title)
      return targetNames.some((target) => normalized.includes(target) || target.includes(normalized))
    })
  }

  const [firstQuery, ...restQueries] = queries
  const firstListings = await searchHub(firstQuery)

  const exact = findExact(firstListings)
  if (exact) return exact

  let bestPartial = findPartial(firstListings) ?? null

  if (restQueries.length > 0 && !bestPartial) {
    const restResults = await Promise.all(restQueries.map((q) => searchHub(q)))
    for (const listings of restResults) {
      const e = findExact(listings)
      if (e) return e
      if (!bestPartial) {
        bestPartial = findPartial(listings) ?? null
      }
    }
  }

  if (!bestPartial) {
    console.warn(
      `[coi-mod-api] Hub 未找到匹配: "${localMod.displayName}" (id=${localMod.id})`,
      `queries: [${queries.map((q) => `"${q}"`).join(', ')}]`,
      `targets: [${targetNames.map((t) => `"${t}"`).join(', ')}]`
    )
  }

  return bestPartial
}

export async function resolveDownloadUrl(sourceUrl: string, hubPageUrl?: string): Promise<string> {
  if (sourceUrl.startsWith(DOWNLOAD_URL_PREFIX)) {
    return sourceUrl
  }

  if (sourceUrl.startsWith(`${HUB_BASE}/Mod/`)) {
    const modPage = normalizeHubPageUrl(hubPageUrl ?? sourceUrl) ?? sourceUrl
    const downloadUrl = await fetchLatestDownloadUrl(modPage)
    if (downloadUrl) {
      return downloadUrl
    }
  }

  throw new Error('Unexpected download URL')
}
