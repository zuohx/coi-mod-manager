import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('HttpApiService', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('should retry failed startup fetches and eventually resolve', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ dirPath: 'C:\\Mods', mods: [] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          }
        })
      )
    globalThis.fetch = fetchMock as typeof fetch

    const { HttpApiService } = await import('@/features/mod-status/model/api-service-http')
    const service = new HttpApiService()
    const pending = service.localScan()

    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual({ dirPath: 'C:\\Mods', mods: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should not retry non-network api failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad request' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      })
    )
    globalThis.fetch = fetchMock as typeof fetch

    const { HttpApiService } = await import('@/features/mod-status/model/api-service-http')
    const service = new HttpApiService()

    await expect(service.localScan()).rejects.toThrow('Bad request')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
