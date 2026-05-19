import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  default: {
    open: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    cp: vi.fn(),
    rm: vi.fn(),
    mkdtemp: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn()
  }
}))

vi.mock('node:child_process', () => ({
  default: {
    execFile: vi.fn()
  }
}))

function createResponse(body: Uint8Array, headers?: Record<string, string>, status = 200) {
  return new Response(body, {
    status,
    headers
  })
}

describe('download archive segmentation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should probe with HEAD and split large downloads into parallel ranges', async () => {
    const fs = await import('node:fs/promises')
    const writes: Array<{ position?: number | bigint | null; size: number }> = []
    vi.mocked(fs.default.open).mockResolvedValue({
      write: vi.fn(async (value: Uint8Array, position?: number | bigint | null) => {
        writes.push({ position, size: value.byteLength })
      }),
      close: vi.fn(async () => undefined)
    } as any)

    const totalBytes = 2 * 1024 * 1024
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      const method = init?.method ?? 'GET'
      const rangeHeader = String(headers?.Range ?? '')

      if (method === 'HEAD') {
        return createResponse(new Uint8Array(), {
          'content-length': String(totalBytes),
          'accept-ranges': 'bytes'
        })
      }

      if (rangeHeader === 'bytes=0-0') {
        return createResponse(new Uint8Array([0]), {
          'content-range': `bytes 0-0/${totalBytes}`,
          'accept-ranges': 'bytes'
        }, 206)
      }

      const match = rangeHeader.match(/bytes=(\d+)-(\d+)/i)
      const start = Number(match?.[1] ?? 0)
      const end = Number(match?.[2] ?? 0)
      const size = end - start + 1
      return createResponse(new Uint8Array(size).fill(1), {
        'content-length': String(size),
        'content-range': `bytes ${start}-${end}/${totalBytes}`
      }, 206)
    })

    vi.stubGlobal('fetch', fetchMock)
    const modApi = await import('../../../server/mod-api.ts')

    await (modApi as any).__test.downloadArchive('https://hub.coigame.com/Mod/DownloadMod/1', 'C:\\tmp\\mod.zip')

    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'HEAD')).toBe(true)

    const rangedCalls = fetchMock.mock.calls.filter((call) => {
      const headers = call[1]?.headers as Record<string, string> | undefined
      const range = headers?.Range ?? ''
      return /^bytes=\d+-\d+$/i.test(range) && range !== 'bytes=0-0'
    })

    expect(rangedCalls).toHaveLength(2)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.reduce((sum, write) => sum + write.size, 0)).toBe(totalBytes)
  })

  it('should choose fewer segments for small files', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const segments = (modApi as any).__test.buildDownloadSegments(3.28 * 1024 * 1024)
    expect(segments).toHaveLength(4)
  })

  it('should fallback to single stream when server does not support ranges', async () => {
    const fs = await import('node:fs/promises')
    const writeChunks: number[] = []
    vi.mocked(fs.default.open).mockResolvedValue({
      write: vi.fn(async (value: Uint8Array) => {
        writeChunks.push(value.byteLength)
      }),
      close: vi.fn(async () => undefined)
    } as any)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      const method = init?.method ?? 'GET'

      if (method === 'HEAD') {
        return createResponse(new Uint8Array(), {
          'content-length': '4'
        })
      }

      if (headers?.Range) {
        return createResponse(new Uint8Array(), {}, 200)
      }

      return createResponse(new Uint8Array([1, 2, 3, 4]), {
        'content-length': '4'
      })
    })

    vi.stubGlobal('fetch', fetchMock)
    const modApi = await import('../../../server/mod-api.ts')

    await (modApi as any).__test.downloadArchive('https://hub.coigame.com/Mod/DownloadMod/2', 'C:\\tmp\\mod.zip')

    expect(writeChunks.reduce((sum, size) => sum + size, 0)).toBe(4)
  })
})
