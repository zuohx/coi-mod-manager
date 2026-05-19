import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('hub cookie session', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should fetch hub cookies before scan requests and forward them', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === 'https://hub.coigame.com/') {
        return new Response('', {
          status: 200,
          headers: {
            'set-cookie': '.AspNetCore.Antiforgery.VyLW6ORzMgk=token; Path=/; HttpOnly'
          }
        })
      }

      if (url === 'https://hub.coigame.com/Mods') {
        return new Response('<html></html>', {
          status: 200,
          headers: {
            'set-cookie': '_pk_ses.2.85de=1; Path=/'
          }
        })
      }

      if (url.includes('/Mods/Search')) {
        const headers = init?.headers as Record<string, string> | undefined
        const cookie = headers?.Cookie ?? headers?.cookie
        expect(cookie).toContain('.AspNetCore.Antiforgery.VyLW6ORzMgk=token')
        expect(cookie).toContain('_pk_ses.2.85de=1')
        expect(headers?.Referer).toBe('https://hub.coigame.com/Mods')
        return new Response('<html></html>', { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    const modApi = await import('../../../server/mod-api.ts')

    const api = (modApi as any).__test
    api.resetHubCookies()
    await api.ensureHubCookies(true)

    expect(api.getHubCookieHeader()).toContain('.AspNetCore.Antiforgery.VyLW6ORzMgk=token')

    await api.searchHub('Demo Mod')

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls).toContain('https://hub.coigame.com/')
    expect(urls).toContain('https://hub.coigame.com/Mods')
    expect(urls.some((url) => url.includes('/Mods/Search'))).toBe(true)
  })

  it('should load browser cookies from config/hub.json', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')

    const tempRoot = await fs.default.mkdtemp(path.join(os.tmpdir(), 'coi-hub-config-'))
    const configDir = path.join(tempRoot, 'config')
    await fs.default.mkdir(configDir, { recursive: true })
    await fs.default.writeFile(
      path.join(configDir, 'hub.json'),
      JSON.stringify({
        cookie:
          '.AspNetCore.Identity.Application=test-token; .AspNetCore.Antiforgery.VyLW6ORzMgk=csrf'
      }),
      'utf8'
    )

    const previousCwd = process.cwd()
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    process.chdir(tempRoot)
    vi.resetModules()

    try {
      const modApi = await import('../../../server/mod-api.ts')
      const api = (modApi as any).__test

      api.resetHubCookies()
      await api.ensureHubCookies(true)

      expect(api.getHubCookieHeader()).toContain('.AspNetCore.Identity.Application=test-token')
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      process.chdir(previousCwd)
      await fs.default.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('should reuse cached cookies until scan forces refresh', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')

    const tempRoot = await fs.default.mkdtemp(path.join(os.tmpdir(), 'coi-hub-cache-'))
    const previousCwd = process.cwd()
    const previousCookie = process.env.COI_HUB_COOKIE
    delete process.env.COI_HUB_COOKIE

    let warmupCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://hub.coigame.com/' || url === 'https://hub.coigame.com/Mods') {
        warmupCalls += 1
        return new Response('', {
          status: 200,
          headers: {
            'set-cookie': `hub_session=token-${warmupCalls}; Path=/`
          }
        })
      }

      return new Response('', { status: 200 })
    })

    process.chdir(tempRoot)
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()

    try {
      const modApi = await import('../../../server/mod-api.ts')
      const api = (modApi as any).__test

      api.resetHubCookies()
      await api.ensureHubCookies(true)
      expect(warmupCalls).toBe(2)
      expect(api.getHubCookieHeader()).toBe('hub_session=token-2')

      await api.ensureHubCookies()
      expect(warmupCalls).toBe(2)

      await api.ensureHubCookies(true)
      expect(warmupCalls).toBe(4)
      expect(api.getHubCookieHeader()).toBe('hub_session=token-4')
    } finally {
      process.chdir(previousCwd)
      if (previousCookie) {
        process.env.COI_HUB_COOKIE = previousCookie
      }
      await fs.default.rm(tempRoot, { recursive: true, force: true })
    }
  })
})
