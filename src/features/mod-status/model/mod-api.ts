export type ModStatus = 'up_to_date' | 'update_available' | 'unknown'

export type CheckingStatus = 'pending' | 'checking' | 'done'

export interface ModRecord {
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
  checkingStatus?: CheckingStatus
}

export interface ScanModsHandlers {
  onStart?: (payload: ScanModsResponse) => void
  onMod?: (mod: ModRecord) => void
}

export interface ScanModsResponse {
  dirPath: string
  mods: ModRecord[]
}

export interface UpgradeProgress {
  phase: 'resolving' | 'downloading' | 'extracting' | 'installing' | 'scanning' | 'completed'
  message: string
  percent?: number
}

type UpgradeStreamEvent =
  | { type: 'progress'; progress: UpgradeProgress }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

type ScanStreamEvent =
  | { type: 'start'; dirPath: string; mods: ModRecord[] }
  | { type: 'mod'; mod: ModRecord }
  | { type: 'complete'; result: ScanModsResponse }
  | { type: 'error'; message: string }

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

async function parseScanStream(
  response: Response,
  handlers?: ScanModsHandlers
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
      if (!trimmed) {
        continue
      }

      const event = JSON.parse(trimmed) as ScanStreamEvent
      if (event.type === 'start') {
        handlers?.onStart?.({
          dirPath: event.dirPath,
          mods: event.mods
        })
        continue
      }

      if (event.type === 'mod') {
        handlers?.onMod?.(event.mod)
        continue
      }

      if (event.type === 'error') {
        throw new Error(event.message)
      }

      if (event.type === 'complete') {
        return event.result
      }
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as ScanStreamEvent
    if (event.type === 'start') {
      handlers?.onStart?.({
        dirPath: event.dirPath,
        mods: event.mods
      })
    } else if (event.type === 'mod') {
      handlers?.onMod?.(event.mod)
    } else if (event.type === 'error') {
      throw new Error(event.message)
    } else if (event.type === 'complete') {
      return event.result
    }
  }

  throw new Error('Scan finished without a completion event')
}

export async function scanMods(handlers?: ScanModsHandlers): Promise<ScanModsResponse> {
  const response = await fetch('/api/mods/scan')
  const contentType = response.headers.get('content-type') ?? ''

  if (response.ok && contentType.includes('application/x-ndjson')) {
    return parseScanStream(response, handlers)
  }

  return parseJsonResponse<ScanModsResponse>(response)
}

export async function localScan(): Promise<ScanModsResponse> {
  const response = await fetch('/api/mods/local')
  return parseJsonResponse<ScanModsResponse>(response)
}

export async function checkMod(installDir: string): Promise<ModRecord> {
  const response = await fetch('/api/mods/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installDir })
  })
  return parseJsonResponse<ModRecord>(response)
}

async function parseUpgradeStream(
  response: Response,
  onProgress?: (progress: UpgradeProgress) => void
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
      if (!trimmed) {
        continue
      }

      const event = JSON.parse(trimmed) as UpgradeStreamEvent
      if (event.type === 'progress') {
        onProgress?.(event.progress)
        continue
      }

      if (event.type === 'error') {
        throw new Error(event.message)
      }

      if (event.type === 'complete') {
        return event.result
      }
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as UpgradeStreamEvent
    if (event.type === 'progress') {
      onProgress?.(event.progress)
    } else if (event.type === 'error') {
      throw new Error(event.message)
    } else if (event.type === 'complete') {
      return event.result
    }
  }

  throw new Error('Upgrade finished without a completion event')
}

export async function upgradeMod(
  installDir: string,
  downloadUrl: string,
  hubPageUrl?: string,
  onProgress?: (progress: UpgradeProgress) => void
): Promise<ScanModsResponse> {
  const response = await fetch('/api/mods/upgrade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      installDir,
      downloadUrl,
      hubPageUrl
    })
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && contentType.includes('application/x-ndjson')) {
    return parseUpgradeStream(response, onProgress)
  }

  return parseJsonResponse<ScanModsResponse>(response)
}
