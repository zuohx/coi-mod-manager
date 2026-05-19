import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCapabilities } from '@/adapters/platform/capabilities'

describe('getCapabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should detect File System Access API support', () => {
    // @ts-ignore
    window.showDirectoryPicker = vi.fn()

    const caps = getCapabilities()

    expect(caps.fileSystemAccess).toBe(true)
  })

  it('should detect missing File System Access API', () => {
    // @ts-ignore
    delete window.showDirectoryPicker

    const caps = getCapabilities()

    expect(caps.fileSystemAccess).toBe(false)
  })

  it('should always return a capabilities object', () => {
    const caps = getCapabilities()

    expect(caps).toBeDefined()
    expect(typeof caps.fileSystemAccess).toBe('boolean')
  })
})
