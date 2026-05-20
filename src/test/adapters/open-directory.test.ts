import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('openDirectoryPath', () => {
  const originalOpen = window.open
  const originalTauriInternals = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    window.open = vi.fn()
  })

  afterEach(() => {
    window.open = originalOpen
    if (originalTauriInternals === undefined) {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    } else {
      ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = originalTauriInternals
    }
  })

  it('should invoke the desktop command in Tauri', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    invokeMock.mockResolvedValue(undefined)
    const { openDirectoryPath } = await import('@/adapters/platform/open-directory')

    await openDirectoryPath('C:\\Mods')

    expect(invokeMock).toHaveBeenCalledWith('open_mod_directory', { path: 'C:\\Mods' })
    expect(window.open).not.toHaveBeenCalled()
  })

  it('should fall back to clipboard copy in the browser', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    invokeMock.mockRejectedValue(new Error('window.__TAURI_INTERNALS__ is undefined'))
    const clipboardMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: clipboardMock } })
    const { openDirectoryPath } = await import('@/adapters/platform/open-directory')

    await expect(openDirectoryPath('C:\\Mods')).rejects.toThrow('已复制到剪贴板')

    expect(clipboardMock).toHaveBeenCalledWith('C:\\Mods')
    expect(invokeMock).toHaveBeenCalledWith('open_mod_directory', { path: 'C:\\Mods' })
    expect(window.open).not.toHaveBeenCalled()
  })

  it('should rethrow real desktop command errors', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    invokeMock.mockRejectedValue(new Error('permission denied'))
    const { openDirectoryPath } = await import('@/adapters/platform/open-directory')

    await expect(openDirectoryPath('C:\\Mods')).rejects.toThrow('permission denied')
    expect(window.open).not.toHaveBeenCalled()
  })
})
