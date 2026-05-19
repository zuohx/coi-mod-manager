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

    vi.mocked(fs.default.readdir).mockImplementation(async (dirPath: any, options: any) => {
      const target = String(dirPath)
      if (target.endsWith('Mods')) {
        return [
          { name: 'mod-a', isDirectory: () => true, isFile: () => false },
          { name: 'nested', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('Mods\\mod-a')) {
        return [
          { name: 'manifest.json', isDirectory: () => false, isFile: () => true }
        ] as any
      }
      if (target.endsWith('Mods\\nested')) {
        return [
          { name: 'group', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('Mods\\nested\\group')) {
        return [
          { name: 'mod-b', isDirectory: () => true, isFile: () => false }
        ] as any
      }
      if (target.endsWith('Mods\\nested\\group\\mod-b')) {
        return [
          { name: 'Manifest.json', isDirectory: () => false, isFile: () => true }
        ] as any
      }
      return [] as any
    })

    vi.mocked(fs.default.access).mockResolvedValue(undefined as any)
    vi.mocked(fs.default.readFile).mockImplementation(async (filePath: any) => {
      const target = String(filePath)
      if (target.includes('mod-a')) {
        return JSON.stringify({
          id: 'mod-a',
          version: '1.0.0',
          display_name: 'Mod A',
          hubUrl: 'https://hub.coigame.com/Mod/1/Mod-A',
          hubVersion: 'v1.0.0',
          authors: ['A']
        })
      }
      return JSON.stringify({
        id: 'mod-b',
        version: '2.0.0',
        display_name: 'Mod B',
        hubUrl: 'https://hub.coigame.com/Mod/2/Mod-B',
        hubVersion: 'v2.0.0',
        authors: 'B'
      })
    })

    const result = await (modApi as any).__test.collectLocalMods('/tmp/test-mods')

    const ids = result.map((item: any) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['mod-a', 'mod-b']))
  })
})
