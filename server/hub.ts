import fs from 'node:fs/promises'
import path from 'node:path'

import { decodeHtmlEntities, normalizeWhitespace, stripTags } from './util'
import type {
  ChangelogEntry,
  HubBrowserHeaderOptions,
  HubListing,
} from './types'

export const HUB_BASE = 'https://hub.coigame.com'
export const HUB_MODS_LIST_URL = `${HUB_BASE}/Mods`
export const DOWNLOAD_URL_PREFIX = `${HUB_BASE}/Mod/DownloadMod/`
export const HUB_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
export const PAGE_CACHE_TTL_MS = 5 * 60 * 1000

export const hubSearchCache = new Map<string, HubListing[]>()
export const hubCookieJar = new Map<string, string>()
export const pageCache = new Map<string, { html: string; timestamp: number }>()

export function resetHubCookies() {
  hubCookieJar.clear()
}

export function resetHubSearchCache() {
  hubSearchCache.clear()
}

export function parseSetCookieHeaders(response: Response): string[] {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }

  return []
}

export function applySetCookies(setCookies: string[]) {
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

export function getHubCookieHeader(): string | undefined {
  if (hubCookieJar.size === 0) {
    return undefined
  }

  return Array.from(hubCookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

export function applyHubCookiesFromString(cookieHeader: string) {
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

export function getHubConfigPath() {
  return path.join(process.cwd(), 'config', 'hub.json')
}

export async function readHubConfigCookie(): Promise<string | undefined> {
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

export async function loadHubCookiesFromConfig(): Promise<boolean> {
  const cookie = await readHubConfigCookie()
  if (!cookie) {
    return false
  }

  applyHubCookiesFromString(cookie)
  return true
}

export function normalizeHubPageUrl(sourceUrl: string): string | undefined {
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

export function buildHubBrowserHeaders(options: HubBrowserHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': HUB_BROWSER_USER_AGENT,
    Accept:
      options.accept ??
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,fr;q=0.7',
    'Sec-CH-UA': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
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

export function buildHubDownloadHeaders(referer: string): Record<string, string> {
  return buildHubBrowserHeaders({
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite: 'same-origin',
    fetchUser: '?1',
  })
}

export function logHubCookies() {
  return getHubCookieHeader()
}

export async function hubFetch(
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
      ...extraHeaders,
    },
    redirect: init?.redirect ?? 'follow',
  })

  applySetCookies(parseSetCookieHeaders(response))
  return response
}

export async function warmHubPage(url: string, referer: string, fetchSite: 'none' | 'same-origin' = 'same-origin') {
  const response = await hubFetch(url, undefined, {
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite,
    fetchUser: fetchSite === 'none' ? '?1' : undefined,
  })

  if (!response.ok) {
    throw new Error(`Failed to warm hub page cookies: ${url} (${response.status})`)
  }

  const html = await response.text()
  pageCache.set(url, { html, timestamp: Date.now() })
}

export async function ensureHubCookies(force = false, modPageUrl?: string): Promise<string | undefined> {
  if (!force && hubCookieJar.size > 0 && !modPageUrl) {
    return getHubCookieHeader()
  }

  if (force) {
    hubCookieJar.clear()
  }
  await loadHubCookiesFromConfig()

  await warmHubPage(`${HUB_BASE}/`, `${HUB_BASE}/`, 'none')
  await warmHubPage(HUB_MODS_LIST_URL, `${HUB_BASE}/`, 'same-origin')

  const normalizedModPageUrl = normalizeHubPageUrl(modPageUrl ?? '')
  if (normalizedModPageUrl) {
    await warmHubPage(normalizedModPageUrl, HUB_MODS_LIST_URL)
  }

  return logHubCookies()
}

export function resolveHubDownloadReferer(downloadUrl: string, hubPageUrl?: string): string {
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

export async function hubDownloadFetch(
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
      ...extraHeaders,
    },
    redirect: init?.redirect ?? 'follow',
  })

  applySetCookies(parseSetCookieHeaders(response))
  return response
}

export async function fetchText(url: string, referer = HUB_MODS_LIST_URL): Promise<string> {
  const cached = pageCache.get(url)
  if (cached && Date.now() - cached.timestamp < PAGE_CACHE_TTL_MS) {
    return cached.html
  }

  const response = await hubFetch(url, undefined, {
    referer,
    fetchDest: 'document',
    fetchMode: 'navigate',
    fetchSite: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(`Hub request failed: ${response.status}`)
  }

  const html = await response.text()
  pageCache.set(url, { html, timestamp: Date.now() })
  return html
}

export async function searchHub(query: string): Promise<HubListing[]> {
  const cached = hubSearchCache.get(query)
  if (cached) {
    return cached
  }

  const endpoints = [`${HUB_BASE}/Mods/Search?query=${encodeURIComponent(query)}`]

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

export function extractHubListings(html: string): HubListing[] {
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

export async function fetchModDetailInfo(modUrl: string, forceRefresh = false): Promise<{
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
    changelog: extractChangelogFromHtml(html),
  }
}

export async function fetchLatestDownloadUrl(modUrl: string): Promise<string | undefined> {
  const detail = await fetchModDetailInfo(modUrl)
  return detail.downloadUrl
}

export function extractFileSizeFromDetailHtml(html: string): string | undefined {
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

export function extractDownloadUrlFromDetailHtml(html: string): string | undefined {
  const anchorMatches = Array.from(
    html.matchAll(/<a\b[^>]*href=(["'])(\/Mod\/DownloadMod\/\d+)\1[^>]*>([\s\S]*?)<\/a>/gi)
  )
  const anchors = anchorMatches.map((match) => ({
    href: match[2],
    label: normalizeWhitespace(stripTags(decodeHtmlEntities(match[3] ?? ''))),
    index: match.index ?? 0,
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

export function extractChangelogFromHtml(html: string): ChangelogEntry[] {
  const tabStart = html.indexOf('id="tab-changelog"')
  if (tabStart < 0) {
    return []
  }

  const afterTab = html.slice(tabStart)
  const nextTabIndex = afterTab.indexOf('id="tab-', 20)
  const tabContent = nextTabIndex > 0 ? afterTab.slice(0, nextTabIndex) : afterTab

  const entries: ChangelogEntry[] = []
  const cardPattern = /<h4[^>]*>([\s\S]*?)<\/h4>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi

  for (const match of tabContent.matchAll(cardPattern)) {
    const rawTitle = normalizeWhitespace(stripTags(decodeHtmlEntities(match[1] ?? '')))
    const rawContent = decodeHtmlEntities(match[2] ?? '')

    const titleMatch = rawTitle.match(/^v?([0-9][0-9A-Za-z.-]*)\s*\|\s*(\d{4}-\d{2}-\d{2})/)
    const version = titleMatch?.[1] ?? rawTitle
    const date = titleMatch?.[2] ?? ''

    const lines = rawContent.split(/\n|&#xA;|&#10;/)
    const contentLines = lines.filter((line) => {
      const trimmed = line.trim()
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
