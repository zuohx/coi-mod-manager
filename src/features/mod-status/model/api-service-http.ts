/**
 * HttpApiService — Web 模式 API 实现
 *
 * 通过 HTTP fetch 调用 Node.js 服务端（Vite Plugin Middleware / standalone server）。
 * 原 mod-api.ts 的逻辑完整迁移至此，保持 100% 行为兼容。
 */

import type {
  IModApiService,
  ModRecord,
  ScanModsResponse,
  ScanEvent,
  UpgradeEvent,
  ChangelogEntry,
} from '@/shared/types/api'

// ============================================================
// 配置
// ============================================================

const API_BASE = import.meta.env.DEV ? '' : 'http://localhost:5174'
const FETCH_RETRY_DELAYS_MS = [150, 350, 750, 1200]

/** Default request timeout in ms (applies to non-streaming requests). */
const REQUEST_TIMEOUT_MS = 120_000

/** Additional retry delays for 5xx server errors. */
const SERVER_ERROR_RETRY_DELAYS_MS = [500, 1000, 2000]

// ============================================================
// 内部工具（与原 mod-api.ts 完全一致）
// ============================================================

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getUrlFromInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|net\.err/i.test(error.message)
}

function isDNSError(error: unknown): boolean {
  return error instanceof TypeError && /enotfound|econnrefused|econnreset|ehostunreach|dns\s*(resolve|lookup)/i.test(error.message)
}

function isCORSError(error: unknown): boolean {
  return error instanceof TypeError && /cors|origin/i.test(error.message)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function buildDetailedFetchError(error: unknown, url: string, attempt: number): Error {
  const originalMessage = error instanceof Error ? error.message : String(error)
  const hints: string[] = []

  if (isAbortError(error)) {
    hints.push('请求被取消')
  } else if (isDNSError(error)) {
    hints.push('无法连接到 API 服务器，请检查服务器是否正在运行（端口 5174）')
  } else if (isCORSError(error)) {
    hints.push('跨域请求被拒绝，请检查 CORS 配置')
  } else if (isNetworkError(error)) {
    if (attempt === 0) {
      hints.push('无法连接到 API 服务器，请检查服务器是否正在运行（端口 5174）')
    } else {
      hints.push(`已重试 ${attempt} 次后仍然无法连接，请检查服务器状态`)
    }
  }

  const hintStr = hints.length > 0 ? `${hints.join('；')}\n` : ''
  return new Error(`${hintStr}[请求失败] ${url}\n${originalMessage}`)
}

async function fetchWithStartupRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = getUrlFromInput(input)
  let lastError: unknown

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init)

      // Retry on 5xx server errors
      if (response.status >= 500 && attempt < FETCH_RETRY_DELAYS_MS.length) {
        const delay = attempt < SERVER_ERROR_RETRY_DELAYS_MS.length
          ? SERVER_ERROR_RETRY_DELAYS_MS[attempt]
          : FETCH_RETRY_DELAYS_MS[attempt]
        console.warn(
          `[coi-mod-manager] HTTP ${response.status} for ${url}, retry ${attempt + 1}/${FETCH_RETRY_DELAYS_MS.length} after ${delay}ms`
        )
        await sleep(delay)
        continue
      }

      return response
    } catch (error) {
      lastError = error
      const shouldRetry = isNetworkError(error) && !isCORSError(error) && !isAbortError(error)
      if (!shouldRetry || attempt === FETCH_RETRY_DELAYS_MS.length) {
        throw buildDetailedFetchError(error, url, attempt)
      }
      await sleep(FETCH_RETRY_DELAYS_MS[attempt])
    }
  }

  const finalError = lastError instanceof Error ? lastError : new Error(String(lastError))
  throw buildDetailedFetchError(finalError, url, FETCH_RETRY_DELAYS_MS.length)
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const data = await response.json()
      if (data && typeof data.message === 'string') {
        message = data.message
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

/**
 * Fetch with configurable timeout via AbortController.
 * Merges the timeout signal with any existing signal in init.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // If the caller already passed a signal, listen to it
  if (init?.signal) {
    if (init.signal.aborted) {
      clearTimeout(timer)
      controller.abort(init.signal.reason)
    } else {
      init.signal.addEventListener('abort', () => controller.abort(init.signal!.reason), { once: true })
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// NDJSON 流解析
// ============================================================

async function parseScanStream(
  response: Response,
  onEvent: (event: ScanEvent) => void
): Promise<ScanModsResponse> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Scan progress stream is unavailable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const event = JSON.parse(trimmed) as ScanEvent
      onEvent(event)

      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'complete') return event.result
    }

    if (done) break
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as ScanEvent
    onEvent(event)
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'complete') return event.result
  }

  throw new Error('Scan finished without a completion event')
}

async function parseUpgradeStream(
  response: Response,
  onEvent: (event: UpgradeEvent) => void
): Promise<ScanModsResponse> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Upgrade progress stream is unavailable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const event = JSON.parse(trimmed) as UpgradeEvent
      onEvent(event)

      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'complete') return event.result
    }

    if (done) break
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as UpgradeEvent
    onEvent(event)
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'complete') return event.result
  }

  throw new Error('Upgrade finished without a completion event')
}

// ============================================================
// HttpApiService 实现
// ============================================================

export class HttpApiService implements IModApiService {
  async localScan(): Promise<ScanModsResponse> {
    const response = await fetchWithStartupRetry(`${API_BASE}/api/mods/local`)
    return parseJsonResponse<ScanModsResponse>(response)
  }

  async streamScan(onEvent: (event: ScanEvent) => void): Promise<ScanModsResponse> {
    const response = await fetchWithStartupRetry(`${API_BASE}/api/mods/scan`)
    const contentType = response.headers.get('content-type') ?? ''

    if (response.ok && contentType.includes('application/x-ndjson')) {
      return parseScanStream(response, onEvent)
    }

    return parseJsonResponse<ScanModsResponse>(response)
  }

  async checkMod(installDir: string): Promise<ModRecord> {
    const response = await fetchWithStartupRetry(`${API_BASE}/api/mods/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installDir }),
    })
    return parseJsonResponse<ModRecord>(response)
  }

  async streamUpgrade(
    installDir: string,
    downloadUrl: string,
    hubPageUrl: string | undefined,
    onEvent: (event: UpgradeEvent) => void
  ): Promise<ScanModsResponse> {
    const response = await fetchWithStartupRetry(`${API_BASE}/api/mods/upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installDir, downloadUrl, hubPageUrl }),
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && contentType.includes('application/x-ndjson')) {
      return parseUpgradeStream(response, onEvent)
    }

    return parseJsonResponse<ScanModsResponse>(response)
  }

  async fetchChangelog(hubUrl: string): Promise<ChangelogEntry[]> {
    const response = await fetchWithStartupRetry(
      `${API_BASE}/api/mods/changelog?url=${encodeURIComponent(hubUrl)}`
    )
    return parseJsonResponse<ChangelogEntry[]>(response)
  }
}
