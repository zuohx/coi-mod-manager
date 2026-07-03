import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'

const execFileAsync = promisify(execFile)

const HUB_BASE = 'https://hub.coigame.com'
const HUB_MODS_LIST_URL = `${HUB_BASE}/Mods`
const DOWNLOAD_URL_PREFIX = `${HUB_BASE}/Mod/DownloadMod/`
const HUB_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const DOWNLOAD_MAX_PARALLEL = 8
const DOWNLOAD_MIN_SEGMENT_BYTES = 1024 * 1024
const DOWNLOAD_WRITE_BUFFER_BYTES = 512 * 1024

const hubSearchCache = new Map<string, HubListing[]>()

const hubCookieJar = new Map<string, string>()

const PAGE_CACHE_TTL_MS = 5 * 60 * 1000
const pageCache = new Map<string, { html: string; timestamp: number }>()

type ModStatus = 'up_to_date' | 'update_available' | 'unknown'

type LocalMod = {
  id: string
  displayName: string
  version: string
  sizeText: string
  authors: string[]
  manifestPath: string
  installDir: string
  hubUrl?: string
  hubVersion?: string
}

type HubListing = {
  title: string
  version?: string
  url: string
}

type ScanResponse = {
  dirPath: string
  mods: ApiModRecord[]
}

type ApiModRecord = {
  id: string
  displayName: string
  version: string
  sizeText: string
  sizeLoading?: boolean
  remoteVersion?: string
  url?: string
  downloadUrl?: string
  status: ModStatus
  manifestPath: string
  installDir: string
  changelogEntries?: ChangelogEntry[]
}

type UpgradeRequest = {
  installDir?: string
  downloadUrl?: string
  hubPageUrl?: string
}

type HubBrowserHeaderOptions = {
  referer?: string
  accept?: string
  fetchDest?: string
  fetchMode?: string
  fetchSite?: string
  fetchUser?: string
}

type UpgradeProgress = {
  phase: 'resolving' | 'downloading' | 'extracting' | 'installing' | 'scanning' | 'completed'
  message: string
  percent?: number
}

type NextFunction = (error?: unknown) => void

export function createModApiPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    void handleRequest(req, res, next)
  }

  return {
    name: 'coi-mod-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    }
  }
}

export function getRequestHandler() {
  return handleRequest
}

export const __test = {
  collectLocalMods,
  extractDownloadUrlFromDetailHtml,
  extractFileSizeFromDetailHtml,
  extractChangelogFromHtml,
  enrichMod,
  downloadArchive,
  buildDownloadSegments,
  probeDownloadMeta,
  ensureHubCookies,
  getHubCookieHeader,
  resetHubCookies,
  resetHubSearchCache: () => hubSearchCache.clear(),
  searchHub,
  applyHubCookiesFromString,
  buildHubBrowserHeaders,
  warmHubPage,
  HUB_MODS_LIST_URL,
  getHubConfigPath,
  loadHubCookiesFromConfig,
  readHubConfigCookie
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFunction
) {
  applyCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!req.url) {
    next()
    return
  }

  const url = new URL(req.url, 'http://localhost')

  const knownRoutes = [
    '/api/mods/scan',
    '/api/mods/upgrade',
    '/api/mods/local',
    '/api/mods/check',
    '/api/mods/changelog'
  ]
  if (!knownRoutes.includes(url.pathname)) {
    next()
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/mods/scan') {
      await streamScan(res)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/mods/local') {
      await handleLocalScan(res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mods/check') {
      const body = await readJsonBody<{ installDir: string }>(req)
      await handleCheckMod(res, body)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mods/upgrade') {
      const body = await readJsonBody<UpgradeRequest>(req)
      await streamUpgrade(res, body)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/mods/changelog') {
      const hubUrl = url.searchParams.get('url') ?? ''
      await handleChangelog(res, hubUrl)
      return
    }

    sendJson(res, 405, { message: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { message })
  }
}

async function streamScan(res: ServerResponse) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    await ensureHubCookies(true)
    const dirPath = getDefaultModsDir()
    const localMods = await collectLocalMods(dirPath)
    const pending = sortModRecords(localMods.map(toPendingMod))

    writeEvent(res, {
      type: 'start',
      dirPath,
      mods: pending
    })

    const enriched: ApiModRecord[] = []
    await mapWithConcurrency(localMods, 4, async (localMod) => {
      const mod = await enrichMod(localMod, true)
      enriched.push(mod)
      writeEvent(res, { type: 'mod', mod })
    })

    const result = sortScanResponse(dirPath, enriched)
    writeEvent(res, {
      type: 'complete',
      result
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeEvent(res, {
      type: 'error',
      message
    })
  } finally {
    res.end()
  }
}

async function handleLocalScan(res: ServerResponse) {
  const dirPath = getDefaultModsDir()
  const localMods = await collectLocalMods(dirPath)
  const pending = sortModRecords(localMods.map(toPendingMod))
  sendJson(res, 200, { dirPath, mods: pending })
}

async function handleCheckMod(res: ServerResponse, body: { installDir: string }) {
  const dirPath = getDefaultModsDir()
  const installDir = body.installDir ? path.resolve(body.installDir) : ''
  if (!installDir) {
    sendJson(res, 400, { message: 'Missing installDir' })
    return
  }

  ensurePathInside(dirPath, installDir)

  const manifestPath = await findManifestPath(installDir)
  if (!manifestPath) {
    sendJson(res, 404, { message: 'Manifest not found' })
    return
  }

  const manifestText = await fs.readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(manifestText)
  const displayName = getManifestDisplayName(parsed) ?? String(parsed.id ?? '')
  const authors = getManifestAuthors(parsed)

  const localMod: LocalMod = {
    id: String(parsed.id ?? ''),
    version: String(parsed.version ?? ''),
    displayName,
    sizeText: '-',
    authors,
    manifestPath,
    installDir,
    hubUrl: getManifestUrl(parsed, ['hubUrl', '_hubUrl']),
    hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion'])
  }

  const enriched = await enrichMod(localMod, true)
  sendJson(res, 200, enriched)
}

type ChangelogEntry = {
  version: string
  date: string
  content: string
}

async function handleChangelog(res: ServerResponse, hubUrl: string) {
  if (!hubUrl || !hubUrl.startsWith(`${HUB_BASE}/Mod/`)) {
    sendJson(res, 400, { message: 'Missing or invalid Hub URL' })
    return
  }

  const html = await fetchText(hubUrl)
  const entries = extractChangelogFromHtml(html)
  sendJson(res, 200, entries)
}

function extractChangelogFromHtml(html: string): ChangelogEntry[] {
  // Locate the #tab-changelog section
  const tabStart = html.indexOf('id="tab-changelog"')
  if (tabStart < 0) {
    return []
  }

  // Find the enclosing div's content (from tabStart to the next sibling tab-pane or end)
  const afterTab = html.slice(tabStart)
  // The tab content ends at the next tab-pane div or end of document
  const nextTabIndex = afterTab.indexOf('id="tab-', 20)
  const tabContent = nextTabIndex > 0 ? afterTab.slice(0, nextTabIndex) : afterTab

  const entries: ChangelogEntry[] = []

  // Match each version card: <h4>...</h4> followed by <pre>...</pre>
  const cardPattern = /<h4[^>]*>([\s\S]*?)<\/h4>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi

  for (const match of tabContent.matchAll(cardPattern)) {
    const rawTitle = normalizeWhitespace(stripTags(decodeHtmlEntities(match[1] ?? '')))
    const rawContent = decodeHtmlEntities(match[2] ?? '')

    // Parse title: "v0.4.3 | 2026-05-04" or "0.4.3 | 2026-05-04"
    const titleMatch = rawTitle.match(/^v?([0-9][0-9A-Za-z.-]*)\s*\|\s*(\d{4}-\d{2}-\d{2})/)
    const version = titleMatch?.[1] ?? rawTitle
    const date = titleMatch?.[2] ?? ''

    // Clean content: remove the duplicated title line if present
    const lines = rawContent.split(/\n|&#xA;|&#10;/)
    const contentLines = lines.filter((line) => {
      const trimmed = line.trim()
      // Skip empty lines and lines that duplicate the title
      if (!trimmed) return false
      if (/^v?[0-9][0-9A-Za-z.-]*\s*\|/.test(trimmed)) return false
      return true
    })

    const content = contentLines.join('\n').trim()
    if (version) {
      entries.push({ version, date, content })
    }
  }

  return entries
}

function toPendingMod(localMod: LocalMod): ApiModRecord {
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
    status: cachedHubVersion
      ? computeStatus(localMod.version, cachedHubVersion)
      : 'unknown',
    manifestPath: localMod.manifestPath,
    installDir: localMod.installDir
  }
}

function finalizeModRecord(record: ApiModRecord): ApiModRecord {
  return {
    ...record,
    sizeLoading: false
  }
}

function sortModRecords(mods: ApiModRecord[]): ApiModRecord[] {
  return [...mods].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
  )
}

function sortScanResponse(dirPath: string, mods: ApiModRecord[]): ScanResponse {
  return {
    dirPath,
    mods: sortModRecords(mods)
  }
}

async function streamUpgrade(res: ServerResponse, body: UpgradeRequest) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendProgress = (progress: UpgradeProgress) => {
    writeEvent(res, {
      type: 'progress',
      progress
    })
  }

  try {
    const result = await upgradeMod(body, sendProgress)
    writeEvent(res, {
      type: 'complete',
      result
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeEvent(res, {
      type: 'error',
      message
    })
  } finally {
    res.end()
  }
}

async function upgradeMod(
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
    percent: 5
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
      percent: 76
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
      percent: 88
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
      percent: 96
    })
    const localMod = await readSingleMod(installDir)
    onProgress?.({
      phase: 'completed',
      message: '升级完成',
      percent: 100
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

type DownloadSegment = {
  start: number
  end: number
}

function resetHubCookies() {
  hubCookieJar.clear()
}

function parseSetCookieHeaders(response: Response): string[] {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }

  return []
}

function applySetCookies(setCookies: string[]) {
  for (const entry of setCookies) {
    const pair = entry.split(';')[0]?.trim()
    if (!pair) {
      continue
    }

    const index = pair.indexOf('=')
    if (index <= 0) {
      continue
    }

    hubCookieJar.set(pair.slice(0, index), pair.slice(index + 1))
  }
}

function getHubCookieHeader(): string | undefined {
  if (hubCookieJar.size === 0) {
    return undefined
  }

  return Array.from(hubCookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function applyHubCookiesFromString(cookieHeader: string) {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) {
      continue
    }

    const index = trimmed.indexOf('=')
    if (index <= 0) {
      continue
    }

    hubCookieJar.set(trimmed.slice(0, index), trimmed.slice(index + 1))
  }
}

function getHubConfigPath() {
  return path.join(process.cwd(), 'config', 'hub.json')
}

async function readHubConfigCookie(): Promise<string | undefined> {
  const envCookie = process.env.COI_HUB_COOKIE?.trim()
  if (envCookie) {
    return envCookie
  }

  const configPath = getHubConfigPath()
  try {
    const text = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(text) as { cookie?: string }
    const cookie = parsed.cookie?.trim()
    return cookie || undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`[coi-mod-api] 读取 Hub 配置失败 (${configPath}):`, error)
    }
    return undefined
  }
}

async function loadHubCookiesFromConfig(): Promise<boolean> {
  const cookie = await readHubConfigCookie()
  if (!cookie) {
    return false
  }

  applyHubCookiesFromString(cookie)
  return true
}

function normalizeHubPageUrl(sourceUrl: string): string | undefined {
  if (!sourceUrl.startsWith(`${HUB_BASE}/Mod/`)) {
    return undefined
  }

  try {
    const parsed = new URL(sourceUrl)
    if (!/^\/Mod\/\d+/i.test(parsed.pathname)) {
      return undefined
    }

    return parsed.toString()
  } catch {
    return undefined
  }
}

function buildHubBrowserHeaders(options: HubBrowserHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': HUB_BROWSER_USER_AGENT,
    Accept:
      options.accept ??
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,fr;q=0.7',
    'Sec-CH-UA': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1'
  }

  if (options.referer) {
    headers.Referer = options.referer
  }

  if (options.fetchDest) {
    headers['Sec-Fetch-Dest'] = options.fetchDest
  }

  if (options.fetchMode) {
    headers['Sec-Fetch-Mode'] = options.fetchMode
  }

  if (options.fetchSite) {
    headers['Sec-Fetch-Site'] = options.fetchSite
  }

  if (options.fetchUser) {
    headers['Sec-Fetch-User'] = options.fetchUser
  }

  const cookie = getHubCookieHeader()
  if (cookie) {
    headers.Cookie = cookie
  }

  return headers
}

function buildHubDownloadHeaders(referer: string): Record<string, string> {
  return buildHubBrowserHeaders({
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite: 'same-origin',
    fetchUser: '?1'
  })
}

function logHubCookies() {
  return getHubCookieHeader()
}

async function hubFetch(
  url: string,
  init?: RequestInit,
  browserOptions?: HubBrowserHeaderOptions
): Promise<Response> {
  const extraHeaders: Record<string, string> = {}
  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      extraHeaders[key] = value
    })
  } else if (Array.isArray(init?.headers)) {
    for (const [key, value] of init.headers) {
      extraHeaders[key] = value
    }
  } else if (init?.headers) {
    Object.assign(extraHeaders, init.headers)
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildHubBrowserHeaders(browserOptions),
      ...extraHeaders
    },
    redirect: init?.redirect ?? 'follow'
  })

  applySetCookies(parseSetCookieHeaders(response))
  return response
}

async function warmHubPage(url: string, referer: string, fetchSite: 'none' | 'same-origin' = 'same-origin') {
  const response = await hubFetch(url, undefined, {
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite,
    fetchUser: fetchSite === 'none' ? '?1' : undefined
  })

  if (!response.ok) {
    throw new Error(`Failed to warm hub page cookies: ${url} (${response.status})`)
  }

  const html = await response.text()
  pageCache.set(url, { html, timestamp: Date.now() })
}

async function ensureHubCookies(
  force = false,
  modPageUrl?: string
): Promise<string | undefined> {
  if (!force && hubCookieJar.size > 0 && !modPageUrl) {
    return getHubCookieHeader()
  }

  if (force) {
    hubCookieJar.clear()
  }  await loadHubCookiesFromConfig()

  await warmHubPage(`${HUB_BASE}/`, `${HUB_BASE}/`, 'none')
  await warmHubPage(HUB_MODS_LIST_URL, `${HUB_BASE}/`, 'same-origin')

  const normalizedModPageUrl = normalizeHubPageUrl(modPageUrl ?? '')
  if (normalizedModPageUrl) {
    await warmHubPage(normalizedModPageUrl, HUB_MODS_LIST_URL)
  }

  return logHubCookies()
}

function resolveHubDownloadReferer(
  downloadUrl: string,
  hubPageUrl?: string
): string {
  const normalizedPage = normalizeHubPageUrl(hubPageUrl ?? '')
  if (normalizedPage) {
    return normalizedPage
  }

  const match = downloadUrl.match(/\/Mod\/DownloadMod\/(\d+)/i)
  if (match?.[1]) {
    return `${HUB_BASE}/Mod/${match[1]}`
  }

  return HUB_MODS_LIST_URL
}

async function hubDownloadFetch(
  downloadUrl: string,
  init?: RequestInit,
  hubPageUrl?: string
): Promise<Response> {
  const referer = resolveHubDownloadReferer(downloadUrl, hubPageUrl)
  const extraHeaders: Record<string, string> = {}
  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      extraHeaders[key] = value
    })
  } else if (Array.isArray(init?.headers)) {
    for (const [key, value] of init.headers) {
      extraHeaders[key] = value
    }
  } else if (init?.headers) {
    Object.assign(extraHeaders, init.headers)
  }

  const response = await fetch(downloadUrl, {
    ...init,
    headers: {
      ...buildHubDownloadHeaders(referer),
      ...extraHeaders
    },
    redirect: init?.redirect ?? 'follow'
  })

  applySetCookies(parseSetCookieHeaders(response))
  return response
}

class BufferedFileWriter {
  private chunks: Buffer[] = []
  private pendingBytes = 0

  constructor(
    private readonly fileHandle: FileHandle,
    private writeOffset: number,
    private readonly flushSize = DOWNLOAD_WRITE_BUFFER_BYTES
  ) {}

  async write(data: Uint8Array): Promise<number> {
    if (data.byteLength === 0) {
      return 0
    }

    this.chunks.push(Buffer.from(data))
    this.pendingBytes += data.byteLength

    if (this.pendingBytes >= this.flushSize) {
      return await this.flush()
    }

    return 0
  }

  async flush() {
    if (this.pendingBytes === 0) {
      return 0
    }

    const payload = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    await this.fileHandle.write(payload, 0, payload.length, this.writeOffset)
    this.writeOffset += payload.length
    const flushed = this.pendingBytes
    this.chunks = []
    this.pendingBytes = 0
    return flushed
  }
}

function buildDownloadSegments(totalBytes: number): DownloadSegment[] {
  const count = Math.min(
    DOWNLOAD_MAX_PARALLEL,
    Math.max(1, Math.ceil(totalBytes / DOWNLOAD_MIN_SEGMENT_BYTES))
  )
  const segmentSize = Math.ceil(totalBytes / count)

  return Array.from({ length: count }, (_, index) => {
    const start = index * segmentSize
    const end = Math.min(totalBytes - 1, start + segmentSize - 1)
    return { start, end }
  }).filter((segment) => segment.start <= segment.end)
}

async function probeDownloadMeta(
  downloadUrl: string,
  hubPageUrl?: string
): Promise<{
  totalBytes: number
  acceptsRanges: boolean
}> {
  let response = await hubDownloadFetch(
    downloadUrl,
    {
      method: 'HEAD'
    },
    hubPageUrl
  )

  if (!response.ok || response.status === 405 || response.status === 501) {
    response = await hubDownloadFetch(
      downloadUrl,
      {
        headers: {
          Range: 'bytes=0-0'
        }
      },
      hubPageUrl
    )
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed: ${response.status}`)
  }

  let totalBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const contentRange = response.headers.get('content-range')
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)\s*$/i)
    if (match?.[1]) {
      totalBytes = Number.parseInt(match[1], 10)
    }
  }

  const acceptsRanges =
    response.headers.get('accept-ranges')?.toLowerCase() === 'bytes' || response.status === 206

  if (response.body) {
    await response.body.cancel()
  }

  return {
    totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
    acceptsRanges
  }
}

function createDownloadProgressReporter(
  totalBytes: number,
  onProgress?: (progress: UpgradeProgress) => void
) {
  let downloadedBytes = 0
  let lastPercent = -1
  let lastReportAt = 0

  return (deltaBytes: number, message: string) => {
    downloadedBytes += deltaBytes
    const now = Date.now()
    const phasePercent =
      totalBytes > 0
        ? 12 + (downloadedBytes / totalBytes) * 58
        : 35
    const currentPercent = Math.max(12, Math.min(70, Math.round(phasePercent)))

    if (currentPercent === lastPercent && now - lastReportAt < 200) {
      return
    }

    lastPercent = currentPercent
    lastReportAt = now
    onProgress?.({
      phase: 'downloading',
      message:
        totalBytes > 0
          ? message
          : `${message} (${formatBytes(downloadedBytes)})`,
      percent: currentPercent
    })
  }
}

async function streamResponseToFile(
  response: Response,
  fileHandle: FileHandle,
  startOffset: number,
  reportProgress: (deltaBytes: number) => void
) {
  if (!response.body) {
    throw new Error('Download stream is unavailable')
  }

  const writer = new BufferedFileWriter(fileHandle, startOffset)
  const reader = response.body.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value) {
        continue
      }

      const flushed = await writer.write(value)
      if (flushed > 0) {
        reportProgress(flushed)
      }
    }
  } finally {
    const flushed = await writer.flush()
    if (flushed > 0) {
      reportProgress(flushed)
    }
  }
}

async function downloadArchive(
  downloadUrl: string,
  zipPath: string,
  onProgress?: (progress: UpgradeProgress) => void,
  hubPageUrl?: string
) {
  onProgress?.({
    phase: 'downloading',
    message: `正在连接下载服务器: ${downloadUrl}`,
    percent: 10
  })

  const { totalBytes, acceptsRanges } = await probeDownloadMeta(downloadUrl, hubPageUrl)
  const supportsSegmentedDownload =
    acceptsRanges && totalBytes > DOWNLOAD_MIN_SEGMENT_BYTES

  try {
    if (supportsSegmentedDownload) {
      await downloadArchiveInSegments(downloadUrl, zipPath, totalBytes, onProgress, hubPageUrl)
    } else {
      await downloadArchiveSingleStream(downloadUrl, zipPath, totalBytes, onProgress, hubPageUrl)
    }
  } catch (error) {
    if (supportsSegmentedDownload) {
      await fs.rm(zipPath, { force: true }).catch(() => undefined)
      await downloadArchiveSingleStream(downloadUrl, zipPath, totalBytes, onProgress, hubPageUrl, {
        message: '分段下载不可用，正在切换为普通下载',
        percent: 18
      })
    } else {
      throw error
    }
  }

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72
  })
}

async function downloadArchiveSingleStream(
  downloadUrl: string,
  zipPath: string,
  totalBytes: number,
  onProgress?: (progress: UpgradeProgress) => void,
  hubPageUrl?: string,
  initialProgress?: Pick<UpgradeProgress, 'message' | 'percent'>
) {
  if (initialProgress) {
    onProgress?.({
      phase: 'downloading',
      ...initialProgress
    })
  }

  // Try PowerShell first on Windows (fastest), then curl, then fetch
  if (process.platform === 'win32' && !process.env.VITEST) {
    try {
      await downloadWithPowerShell(downloadUrl, zipPath, hubPageUrl, onProgress)
      return
    } catch {
      // PowerShell not available or failed, try curl
    }
    try {
      await downloadWithCurl(downloadUrl, zipPath, hubPageUrl, onProgress)
      return
    } catch {
      // Fallback to fetch-based download
    }
  }

  const response = await hubDownloadFetch(downloadUrl, undefined, hubPageUrl)

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`)
  }

  const resolvedTotalBytes =
    totalBytes > 0
      ? totalBytes
      : Number.parseInt(response.headers.get('content-length') ?? '', 10) || 0

  const reportProgress = createDownloadProgressReporter(
    resolvedTotalBytes,
    onProgress
  )

  const fileHandle = await fs.open(zipPath, 'w')
  try {
    await streamResponseToFile(response, fileHandle, 0, (deltaBytes) => {
      reportProgress(deltaBytes, '正在下载更新包')
    })
  } finally {
    await fileHandle.close()
  }
}

async function downloadWithPowerShell(
  downloadUrl: string,
  zipPath: string,
  hubPageUrl?: string,
  onProgress?: (progress: UpgradeProgress) => void
) {
  const referer = resolveHubDownloadReferer(downloadUrl, hubPageUrl)
  const cookie = getHubCookieHeader() ?? ''

  // Build a PS script that uses WebClient with proper headers
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    '$wc = New-Object System.Net.WebClient',
    `$wc.Headers.Add("User-Agent", "${HUB_BROWSER_USER_AGENT.replace(/"/g, '""')}")`,
    `$wc.Headers.Add("Referer", "${referer.replace(/"/g, '""')}")`,
    cookie ? `$wc.Headers.Add("Cookie", "${cookie.replace(/"/g, '""')}")` : '',
    `$wc.DownloadFile("${downloadUrl.replace(/"/g, '""')}", "${zipPath.replace(/\\/g, '\\\\').replace(/"/g, '""')}")`,
    'Write-Output "OK"'
  ]
    .filter(Boolean)
    .join('; ')

  onProgress?.({
    phase: 'downloading',
    message: `正在通过系统通道下载: powershell -Command "${psScript.substring(0, 100)}..."`,
    percent: 15
  })

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psScript
  ], {
    windowsHide: true,
    timeout: 300_000
  })

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72
  })
}

async function downloadWithCurl(
  downloadUrl: string,
  zipPath: string,
  hubPageUrl?: string,
  onProgress?: (progress: UpgradeProgress) => void
) {
  const referer = resolveHubDownloadReferer(downloadUrl, hubPageUrl)
  const cookie = getHubCookieHeader() ?? ''

  onProgress?.({
    phase: 'downloading',
    message: '正在通过系统通道下载',
    percent: 15
  })

  const args = [
    '-L',
    '--silent',
    '--show-error',
    '--max-time', '300',
    '--retry', '2',
    '--retry-delay', '1',
    '-o', zipPath,
    '-H', `User-Agent: ${HUB_BROWSER_USER_AGENT}`,
    '-H', `Referer: ${referer}`,
  ]

  if (cookie) {
    args.push('-H', `Cookie: ${cookie}`)
  }

  args.push(downloadUrl)

  await execFileAsync('curl.exe', args, {
    windowsHide: true,
    timeout: 360_000
  })

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72
  })
}

async function downloadArchiveInSegments(
  downloadUrl: string,
  zipPath: string,
  totalBytes: number,
  onProgress?: (progress: UpgradeProgress) => void,
  hubPageUrl?: string
) {
  const segments = buildDownloadSegments(totalBytes)
  const fileHandle = await fs.open(zipPath, 'w')
  const segmentBytes = new Array(segments.length).fill(0)

  const reportProgress = (segmentIndex: number, deltaBytes: number) => {
    segmentBytes[segmentIndex] += deltaBytes
    const downloadedBytes = segmentBytes.reduce((sum, value) => sum + value, 0)
    const phasePercent = 12 + (downloadedBytes / totalBytes) * 58
    const currentPercent = Math.max(12, Math.min(70, Math.round(phasePercent)))

    onProgress?.({
      phase: 'downloading',
      message: `正在并行下载更新包（${segments.length} 路）`,
      percent: currentPercent
    })
  }

  try {
    await mapWithConcurrency(
      segments.map((segment, segmentIndex) => ({ segment, segmentIndex })),
      DOWNLOAD_MAX_PARALLEL,
      async ({ segment, segmentIndex }) => {
      const response = await hubDownloadFetch(
        downloadUrl,
        {
          headers: {
            Range: `bytes=${segment.start}-${segment.end}`
          }
        },
        hubPageUrl
      )

      if (response.status !== 206 || !response.body) {
        throw new Error('Segmented download is not supported by the server')
      }

      const writer = new BufferedFileWriter(fileHandle, segment.start)
      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        if (!value) {
          continue
        }

        const flushed = await writer.write(value)
        if (flushed > 0) {
          reportProgress(segmentIndex, flushed)
        }
      }

      const flushed = await writer.flush()
      if (flushed > 0) {
        reportProgress(segmentIndex, flushed)
      }
    }
    )
  } finally {
    await fileHandle.close()
  }
}

async function enrichMod(localMod: LocalMod, forceRefresh = false): Promise<ApiModRecord> {
  const base: ApiModRecord = {
    id: localMod.id,
    displayName: localMod.displayName,
    version: localMod.version,
    sizeText: localMod.sizeText,
    manifestPath: localMod.manifestPath,
    installDir: localMod.installDir,
    status: 'unknown'
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
            status: computeStatus(localMod.version, cachedHubVersion)
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
          status: computeStatus(localMod.version, hubListing.version)
        },
        hubListing.url,
        forceRefresh
      )
    )
  } catch {
    return finalizeModRecord(base)
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
      changelogEntries: detail.changelog
    }
  } catch {
    return record
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
      return targetNames.some(
        (target) => normalized.includes(target) || target.includes(normalized)
      )
    })
  }

  // Try displayName first (most likely to match)
  const [firstQuery, ...restQueries] = queries
  const firstListings = await searchHub(firstQuery)

  const exact = findExact(firstListings)
  if (exact) return exact

  let bestPartial = findPartial(firstListings) ?? null

  // Parallelize remaining queries
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

async function resolveDownloadUrl(
  sourceUrl: string,
  hubPageUrl?: string
): Promise<string> {
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

async function searchHub(query: string): Promise<HubListing[]> {
  const cached = hubSearchCache.get(query)
  if (cached) {
    return cached
  }

  const endpoints = [
    `${HUB_BASE}/Mods/Search?query=${encodeURIComponent(query)}`
  ]

  const results = await (async () => {
    try {
      return await fetchText(endpoints[0]).then(extractHubListings)
    } catch {
      return [] as HubListing[]
    }
  })()

  if (results.length > 0) {
    hubSearchCache.set(query, results)
  }

  return results
}

function extractHubListings(html: string): HubListing[] {
  const matches: HubListing[] = []
  const seen = new Set<string>()
  const anchorPattern = /<a\b[^>]*href=(["'])(\/Mod\/\d+\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[2]
    const content = normalizeWhitespace(stripTags(decodeHtmlEntities(match[3] ?? '')))
    const parsed = content.match(/^(.*?)\s+v([0-9][0-9A-Za-z.-]*)\s+by\b/i)

    if (!parsed) {
      continue
    }

    const title = parsed[1]?.trim()
    const version = parsed[2]?.trim()
    const url = new URL(href, HUB_BASE).toString()

    if (!title || seen.has(url)) {
      continue
    }

    seen.add(url)
    matches.push({ title, version, url })
  }

  return matches
}

async function fetchModDetailInfo(modUrl: string, forceRefresh = false): Promise<{
  downloadUrl?: string
  sizeText?: string
  changelog?: ChangelogEntry[]
}> {
  if (forceRefresh) {
    pageCache.delete(modUrl)
  }
  const html = await fetchText(modUrl, HUB_MODS_LIST_URL)
  return {
    downloadUrl: extractDownloadUrlFromDetailHtml(html),
    sizeText: extractFileSizeFromDetailHtml(html),
    changelog: extractChangelogFromHtml(html)
  }
}

async function fetchLatestDownloadUrl(modUrl: string): Promise<string | undefined> {
  const detail = await fetchModDetailInfo(modUrl)
  return detail.downloadUrl
}

function extractFileSizeFromDetailHtml(html: string): string | undefined {
  const findSizeInContext = (context: string): string | undefined => {
    const match = context.match(/File\s*size[\s\S]{0,240}?(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B))/i)
    if (!match?.[1]) {
      return undefined
    }

    return normalizeWhitespace(match[1])
  }

  const latestIndex = html.search(/\bLatest\b/i)
  if (latestIndex >= 0) {
    const afterLatest = html.slice(latestIndex, Math.min(html.length, latestIndex + 2400))
    const latestSize = findSizeInContext(afterLatest)
    if (latestSize) {
      return latestSize
    }
  }

  return findSizeInContext(html)
}

function extractDownloadUrlFromDetailHtml(html: string): string | undefined {
  const anchorMatches = Array.from(
    html.matchAll(/<a\b[^>]*href=(["'])(\/Mod\/DownloadMod\/\d+)\1[^>]*>([\s\S]*?)<\/a>/gi)
  )
  const anchors = anchorMatches.map((match) => ({
    href: match[2],
    label: normalizeWhitespace(stripTags(decodeHtmlEntities(match[3] ?? ''))),
    index: match.index ?? 0
  }))

  const uniqueCandidates = Array.from(new Set(anchors.map((anchor) => anchor.href)))

  const labeledAnchor = anchors.find((anchor) => /download/i.test(anchor.label))
  if (labeledAnchor) {
    const contextStart = Math.max(0, labeledAnchor.index - 240)
    const contextEnd = Math.min(html.length, labeledAnchor.index + 240)
    const context = html.slice(contextStart, contextEnd)

    if (/latest/i.test(context)) {
      return new URL(labeledAnchor.href, HUB_BASE).toString()
    }
  }

  if (labeledAnchor) {
    return new URL(labeledAnchor.href, HUB_BASE).toString()
  }

  const rawMatch = html.match(/\/Mod\/DownloadMod\/\d+/i)
  if (rawMatch?.[0]) {
    return new URL(rawMatch[0], HUB_BASE).toString()
  }

  if (uniqueCandidates.length === 0) {
    return undefined
  }

  return new URL(uniqueCandidates[0], HUB_BASE).toString()
}

function computeStatus(localVersion: string, remoteVersion?: string): ModStatus {
  if (!remoteVersion) {
    return 'unknown'
  }

  return compareVersions(localVersion, remoteVersion) >= 0 ? 'up_to_date' : 'update_available'
}

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment.replace(/[^\d].*$/, ''), 10) || 0)
}

function compareVersions(left: string, right: string): number {
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

async function readSingleMod(installDir: string): Promise<LocalMod | null> {
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
        hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion'])
      }
    }
  } catch {
    // Invalid manifest
  }

  return null
}

async function collectLocalMods(dirPath: string): Promise<LocalMod[]> {
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

        if (
          typeof parsed.id === 'string' &&
          typeof parsed.version === 'string'
        ) {
          mods.push({
            id: parsed.id,
            version: parsed.version,
            displayName: displayName ?? parsed.id,
            sizeText: '-',
            authors,
            manifestPath,
            installDir: currentDir,
            hubUrl: getManifestUrl(parsed, ['hubUrl', '_hubUrl']),
            hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion'])
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

function getManifestDisplayName(parsed: unknown): string | null {
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

function getManifestAuthors(parsed: unknown): string[] {
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

function getManifestUrl(parsed: unknown, keys: string[]): string | undefined {
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

function normalizeRemoteVersion(value?: string): string | undefined {
  if (!value) {
    return undefined
  }

  return value.replace(/^v/i, '').trim() || undefined
}

async function findManifestPath(dirPath: string): Promise<string | null> {
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

async function locateExtractedModRoot(rootDir: string): Promise<string | null> {
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

async function extractArchive(zipPath: string, destinationPath: string) {
  // 优先 tar（Windows 10+ 自带，速度远快于 Expand-Archive）
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destinationPath], {
      windowsHide: true
    })
    return
  } catch {
    // tar 不可用或失败，fallback 到 PowerShell
  }

  const escapedZip = zipPath.replace(/'/g, "''")
  const escapedDest = destinationPath.replace(/'/g, "''")
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force`
    ],
    {
      windowsHide: true
    }
  )
}

async function fetchText(url: string, referer = HUB_MODS_LIST_URL): Promise<string> {
  const cached = pageCache.get(url)
  if (cached && Date.now() - cached.timestamp < PAGE_CACHE_TTL_MS) {
    return cached.html
  }

  const response = await hubFetch(url, undefined, {
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite: 'same-origin'
  })

  if (!response.ok) {
    throw new Error(`Hub request failed: ${response.status}`)
  }

  const html = await response.text()
  pageCache.set(url, { html, timestamp: Date.now() })
  return html
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeName(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/\+\+/g, ' plus plus ')
      .replace(/\+/g, ' plus ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
  )
}

function getDefaultModsDir(): string {
  const appData =
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')

  return path.join(appData, 'Captain of Industry', 'Mods')
}

function ensurePathInside(parentDir: string, childPath: string) {
  const resolvedParent = path.resolve(parentDir)
  const resolvedChild = path.resolve(childPath)
  const withSeparator = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : `${resolvedParent}${path.sep}`

  if (!resolvedChild.startsWith(withSeparator)) {
    throw new Error('Path escapes default Mods directory')
  }
}

async function readDirectoryEntries(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const text = Buffer.concat(chunks).toString('utf8')
  return text ? (JSON.parse(text) as T) : ({} as T)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeEvent(res: ServerResponse, payload: unknown) {
  res.write(`${JSON.stringify(payload)}\n`)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker))
  return results
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const unique: T[] = []

  for (const item of items) {
    const key = getKey(item)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(item)
  }

  return unique
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${bytes} B`
}
