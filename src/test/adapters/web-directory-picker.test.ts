import { describe, it, expect, vi } from 'vitest'
import { pickDirectory } from '@/adapters/file/web-directory-picker'

describe('pickDirectory', () => {
  it('should return directory handle when user selects directory', async () => {
    // Mock showDirectoryPicker
    const mockHandle = {
      kind: 'directory',
      name: 'Mods'
    }
    // @ts-ignore
    window.showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle)

    const result = await pickDirectory()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Mods')
    }
  })

  it('should return error when user cancels', async () => {
    // Mock showDirectoryPicker to throw AbortError
    // @ts-ignore
    window.showDirectoryPicker = vi.fn().mockRejectedValue(
      new DOMException('The user aborted a request', 'AbortError')
    )

    const result = await pickDirectory()

    expect(result.ok).toBe(false)
  })

  it('should return error when API is not supported', async () => {
    // @ts-ignore
    delete window.showDirectoryPicker

    const result = await pickDirectory()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('not supported')
    }
  })
})
