import { describe, it, expect, vi } from 'vitest'
import { readManifestFile } from '@/adapters/file/web-manifest-reader'

describe('readManifestFile', () => {
  it('should read and parse manifest.json', async () => {
    const mockFileHandle = {
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify({
          id: 'test-mod',
          version: '1.0.0',
          displayName: 'Test Mod',
          authors: ['Author1']
        }))
      })
    }

    const result = await readManifestFile(mockFileHandle as any)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('test-mod')
      expect(result.value.version).toBe('1.0.0')
    }
  })

  it('should return error when file read fails', async () => {
    const mockFileHandle = {
      getFile: vi.fn().mockRejectedValue(new Error('File read error'))
    }

    const result = await readManifestFile(mockFileHandle as any)

    expect(result.ok).toBe(false)
  })

  it('should return error when JSON is invalid', async () => {
    const mockFileHandle = {
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue('invalid json')
      })
    }

    const result = await readManifestFile(mockFileHandle as any)

    expect(result.ok).toBe(false)
  })
})
