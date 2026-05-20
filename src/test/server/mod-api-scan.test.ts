import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    cp: vi.fn(),
    rm: vi.fn(),
    mkdtemp: vi.fn(),
    access: vi.fn()
  }
}))

vi.mock('node:child_process', () => ({
  default: {
    execFile: vi.fn()
  }
}))

describe('mod api scan recursion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should collect manifest.json files from nested directories', async () => {
    const fs = await import('node:fs/promises')
    const modApi = await import('../../../server/mod-api.ts')

    // List of paths that actually have manifest.json files
    const validManifests = new Set([
      '/tmp/Mods/mod-a/manifest.json',
      '/tmp/Mods/nested/group/mod-b/Manifest.json'
    ])

    vi.mocked(fs.default.readdir).mockImplementation(async (dirPath: any, _options: any) => {
      // Normalize path separators for cross-platform compatibility
      const target = String(dirPath).replace(/\\/g, '/')
      if (target.endsWith('/Mods')) {
        return [
          { name: 'mod-a', isDirectory: () => true, isFile: () => false },
          { name: 'nested', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('/Mods/mod-a')) {
        return [
          { name: 'manifest.json', isDirectory: () => false, isFile: () => true }
        ] as any
      }
      if (target.endsWith('/Mods/nested')) {
        return [
          { name: 'group', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('/Mods/nested/group')) {
        return [
          { name: 'mod-b', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('/Mods/nested/group/mod-b')) {
        return [
          { name: 'Manifest.json', isDirectory: () => false, isFile: () => true }
        ] as any
      }
      return [] as any
    })

    vi.mocked(fs.default.access).mockImplementation(async (targetPath: any) => {
      const normalized = String(targetPath).replace(/\\/g, '/')
      if (!validManifests.has(normalized)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    })

    vi.mocked(fs.default.readFile).mockImplementation(async (filePath: any) => {
      const target = String(filePath).replace(/\\/g, '/')
      if (target.includes('/mod-a/')) {
        return JSON.stringify({
          id: 'mod-a',
          version: '1.0.0',
          display_name: 'Mod A',
          hubUrl: 'https://hub.coigame.com/Mod/1/Mod-A',
          hubVersion: 'v1.0.0',
          authors: ['A']
        })
      }
      if (target.includes('/mod-b/')) {
        return JSON.stringify({
          id: 'mod-b',
          version: '2.0.0',
          display_name: 'Mod B',
          hubUrl: 'https://hub.coigame.com/Mod/2/Mod-B',
          hubVersion: 'v2.0.0',
          authors: 'B'
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await (modApi as any).__test.collectLocalMods('/tmp/Mods')

    const ids = result.map((item: any) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['mod-a', 'mod-b']))
  })

  it('should answer CORS preflight for standalone api requests', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const handler = modApi.getRequestHandler()
    const setHeader = vi.fn()
    const end = vi.fn()
    const next = vi.fn()

    await handler(
      {
        method: 'OPTIONS',
        url: '/api/mods/local',
        headers: {
          origin: 'tauri://localhost'
        }
      } as any,
      {
        setHeader,
        end,
        statusCode: 0
      } as any,
      next
    )

    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'tauri://localhost')
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type')
    expect(end).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('should include CORS headers on api responses', async () => {
    const fs = await import('node:fs/promises')
    const modApi = await import('../../../server/mod-api.ts')
    const handler = modApi.getRequestHandler()
    const setHeader = vi.fn()
    const end = vi.fn()

    vi.mocked(fs.default.readdir).mockResolvedValue([] as any)

    const res = {
      setHeader,
      end,
      statusCode: 0
    } as any

    await handler(
      {
        method: 'GET',
        url: '/api/mods/local',
        headers: {
          origin: 'tauri://localhost'
        }
      } as any,
      res,
      vi.fn()
    )

    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'tauri://localhost')
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(end).toHaveBeenCalled()
  })
})
