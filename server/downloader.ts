import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { HUB_BROWSER_USER_AGENT, getHubCookieHeader, hubDownloadFetch, resolveHubDownloadReferer } from './hub'
import { formatBytes, mapWithConcurrency } from './util'
import type { DownloadSegment, UpgradeProgress } from './types'

const execFileAsync = promisify(execFile)

export const DOWNLOAD_MAX_PARALLEL = 8
export const DOWNLOAD_MIN_SEGMENT_BYTES = 1024 * 1024
export const DOWNLOAD_WRITE_BUFFER_BYTES = 512 * 1024

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

export function buildDownloadSegments(totalBytes: number): DownloadSegment[] {
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

export async function probeDownloadMeta(
  downloadUrl: string,
  hubPageUrl?: string
): Promise<{
  totalBytes: number
  acceptsRanges: boolean
}> {
  let response = await hubDownloadFetch(
    downloadUrl,
    {
      method: 'HEAD',
    },
    hubPageUrl
  )

  if (!response.ok || response.status === 405 || response.status === 501) {
    response = await hubDownloadFetch(
      downloadUrl,
      {
        headers: {
          Range: 'bytes=0-0',
        },
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

  const acceptsRanges = response.headers.get('accept-ranges')?.toLowerCase() === 'bytes' || response.status === 206

  if (response.body) {
    await response.body.cancel()
  }

  return {
    totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
    acceptsRanges,
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
    const phasePercent = totalBytes > 0 ? 12 + (downloadedBytes / totalBytes) * 58 : 35
    const currentPercent = Math.max(12, Math.min(70, Math.round(phasePercent)))

    if (currentPercent === lastPercent && now - lastReportAt < 200) {
      return
    }

    lastPercent = currentPercent
    lastReportAt = now
    onProgress?.({
      phase: 'downloading',
      message: totalBytes > 0 ? message : `${message} (${formatBytes(downloadedBytes)})`,
      percent: currentPercent,
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

export async function downloadArchive(
  downloadUrl: string,
  zipPath: string,
  onProgress?: (progress: UpgradeProgress) => void,
  hubPageUrl?: string
) {
  onProgress?.({
    phase: 'downloading',
    message: `正在连接下载服务器: ${downloadUrl}`,
    percent: 10,
  })

  const { totalBytes, acceptsRanges } = await probeDownloadMeta(downloadUrl, hubPageUrl)
  const supportsSegmentedDownload = acceptsRanges && totalBytes > DOWNLOAD_MIN_SEGMENT_BYTES

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
        percent: 18,
      })
    } else {
      throw error
    }
  }

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72,
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
      ...initialProgress,
    })
  }

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

  const resolvedTotalBytes = totalBytes > 0 ? totalBytes : Number.parseInt(response.headers.get('content-length') ?? '', 10) || 0

  const reportProgress = createDownloadProgressReporter(resolvedTotalBytes, onProgress)

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

  const psScript = [
    '$ErrorActionPreference = "Stop"',
    '$wc = New-Object System.Net.WebClient',
    `$wc.Headers.Add("User-Agent", "${HUB_BROWSER_USER_AGENT.replace(/"/g, '""')}")`,
    `$wc.Headers.Add("Referer", "${referer.replace(/"/g, '""')}")`,
    cookie ? `$wc.Headers.Add("Cookie", "${cookie.replace(/"/g, '""')}")` : '',
    `$wc.DownloadFile("${downloadUrl.replace(/"/g, '""')}", "${zipPath.replace(/\\/g, '\\\\').replace(/"/g, '""')}")`,
    'Write-Output "OK"',
  ]
    .filter(Boolean)
    .join('; ')

  onProgress?.({
    phase: 'downloading',
    message: `正在通过系统通道下载: powershell -Command "${psScript.substring(0, 100)}..."`,
    percent: 15,
  })

  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    windowsHide: true,
    timeout: 300_000,
  })

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72,
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
    percent: 15,
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
    timeout: 360_000,
  })

  onProgress?.({
    phase: 'downloading',
    message: '下载完成',
    percent: 72,
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
      percent: currentPercent,
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
              Range: `bytes=${segment.start}-${segment.end}`,
            },
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
