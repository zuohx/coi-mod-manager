import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { IModApiService, ScanModsResponse, ModRecord, UpgradeEvent } from '@/shared/types/api'

// Mock the entire api-service module
const mockLocalScan = vi.fn<() => Promise<ScanModsResponse>>()
const mockCheckMod = vi.fn<(installDir: string) => Promise<ModRecord>>()
const mockStreamUpgrade = vi.fn<
  (installDir: string, downloadUrl: string, hubPageUrl: string | undefined, onEvent: (event: UpgradeEvent) => void) => Promise<ScanModsResponse>
>()

const mockService: IModApiService = {
  localScan: mockLocalScan,
  checkMod: mockCheckMod,
  streamScan: vi.fn(),
  streamUpgrade: mockStreamUpgrade,
  fetchChangelog: vi.fn(),
}

vi.mock('@/features/mod-status/model/api-service', () => ({
  createApiService: () => mockService,
}))

const localModFixture: ModRecord = {
  id: 'mod-1',
  version: '1.0.0',
  displayName: 'Mod 1',
  sizeText: '-',
  sizeLoading: true,
  remoteVersion: undefined,
  url: undefined,
  downloadUrl: undefined,
  status: 'unknown',
  manifestPath: 'C:\\Mods\\mod-1\\manifest.json',
  installDir: 'C:\\Mods\\mod-1'
}

const enrichedModFixture: ModRecord = {
  ...localModFixture,
  sizeText: '1.2 MB',
  sizeLoading: false,
  remoteVersion: '1.2.0',
  url: 'https://hub.coigame.com/Mod/1/Mod-1',
  downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
  status: 'update_available'
}

describe('useModScan', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('should return initial state', async () => {
    mockLocalScan.mockResolvedValue({ dirPath: 'C:\\Mods', mods: [] })
    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')

    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.mods).toEqual([])
    expect(result.current.scanning).toBe(false)
    expect(result.current.checkingCount).toBe(0)
    expect(result.current.error).toBe(null)
    expect(typeof result.current.scan).toBe('function')
    expect(typeof result.current.upgrade).toBe('function')
  })

  it('should load mods on mount and auto-check updates', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture]
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.mods).toHaveLength(1)
    expect(result.current.mods[0].id).toBe('mod-1')
    expect(result.current.dirPath).toBe('C:\\Mods')
    expect(result.current.error).toBe(null)
    expect(mockLocalScan).toHaveBeenCalledTimes(1)
    // Auto-check runs on mount
    expect(mockCheckMod).toHaveBeenCalled()
  })

  it('should handle scan error', async () => {
    mockLocalScan.mockRejectedValue(new Error('Scan failed'))

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.scanning).toBe(false)
    expect(result.current.mods).toEqual([])
    expect(result.current.error).not.toBe(null)
  })

  it('should upgrade a mod and replace list', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture]
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)
    mockStreamUpgrade.mockImplementation(async (
      _installDir: string,
      _downloadUrl: string,
      _hubPageUrl: string | undefined,
      onEvent?: (event: UpgradeEvent) => void
    ): Promise<ScanModsResponse> => {
      // Emit progress event (new format: { type: 'progress', progress: {...} })
      onEvent?.({
        type: 'progress',
        progress: {
          phase: 'downloading',
          message: '正在下载更新包',
          percent: 48
        }
      })
      // Return result via promise
      return {
        dirPath: 'C:\\Mods',
        mods: [
          {
            ...enrichedModFixture,
            version: '1.2.0',
            sizeText: '1.4 MB',
            downloadUrl: undefined,
            status: 'up_to_date'
          }
        ]
      }
    })

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    // Check updates to enrich mods with downloadUrl and url
    await act(async () => {
      await result.current.checkUpdates()
    })

    await act(async () => {
      await result.current.upgrade(result.current.mods[0])
    })

    expect(mockStreamUpgrade).toHaveBeenCalledWith(
      'C:\\Mods\\mod-1',
      'https://hub.coigame.com/Mod/DownloadMod/1',
      'https://hub.coigame.com/Mod/1/Mod-1',
      expect.any(Function)
    )
    expect(result.current.mods[0].version).toBe('1.2.0')
  })

  it('should fallback to hub url when direct download url is missing', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture]
    })
    mockCheckMod.mockResolvedValue({
      ...enrichedModFixture,
      downloadUrl: undefined
    })
    mockStreamUpgrade.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: []
    })

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    // Check updates to enrich mods with url
    await act(async () => {
      await result.current.checkUpdates()
    })

    await act(async () => {
      await result.current.upgrade(result.current.mods[0])
    })

    expect(mockStreamUpgrade).toHaveBeenCalledWith(
      'C:\\Mods\\mod-1',
      'https://hub.coigame.com/Mod/1/Mod-1',
      'https://hub.coigame.com/Mod/1/Mod-1',
      expect.any(Function)
    )
  })

  it('should expose upgrade progress while upgrading', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture]
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)
    let capturedEvent: UpgradeEvent | undefined
    mockStreamUpgrade.mockImplementation(async (
      _installDir: string,
      _downloadUrl: string,
      _hubPageUrl: string | undefined,
      onEvent?: (event: UpgradeEvent) => void
    ): Promise<ScanModsResponse> => {
      const event: UpgradeEvent = {
        type: 'progress',
        progress: {
          phase: 'downloading',
          message: '正在下载更新包',
          percent: 52
        }
      }
      capturedEvent = event
      onEvent?.(event)
      return {
        dirPath: 'C:\\Mods',
        mods: []
      }
    })

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })

    // Check updates to enrich mods with downloadUrl and url
    await act(async () => {
      await result.current.checkUpdates()
    })

    await act(async () => {
      await result.current.upgrade(result.current.mods[0])
    })

    expect(capturedEvent).toBeDefined()
    // Upgrade progress map should be empty after upgrade completes (cleaned up in finally)
    expect(result.current.upgradeProgressMap).toEqual({})
  })

  it('should check mods in parallel and update checkingCount', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [
        { ...localModFixture, id: 'mod-a', displayName: 'Mod A', installDir: 'C:\\Mods\\mod-a' },
        { ...localModFixture, id: 'mod-b', displayName: 'Mod B', installDir: 'C:\\Mods\\mod-b' }
      ]
    })

    let checkResolveFns: Array<(v: ModRecord) => void> = []
    mockCheckMod.mockImplementation(
      () => new Promise<ModRecord>((resolve) => checkResolveFns.push(resolve))
    )

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    // Wait for local scan + auto-check to start
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.mods).toHaveLength(2)
    // Auto-check starts on mount, so mods should already be checking
    expect(result.current.checkingCount).toBe(2)
    expect(result.current.mods[0].checkingStatus).toBe('checking')
    expect(result.current.mods[1].checkingStatus).toBe('checking')

    // Resolve first mod
    await act(async () => {
      checkResolveFns[0]({ ...enrichedModFixture, id: 'mod-a', displayName: 'Mod A' })
      await Promise.resolve()
    })

    expect(result.current.checkingCount).toBe(1)
    expect(result.current.mods[0].checkingStatus).toBe('done')
    expect(result.current.mods[1].checkingStatus).toBe('checking')

    // Resolve second mod
    await act(async () => {
      checkResolveFns[1]({ ...enrichedModFixture, id: 'mod-b', displayName: 'Mod B' })
      await Promise.resolve()
    })

    expect(result.current.checkingCount).toBe(0)
    expect(result.current.mods[0].checkingStatus).toBe('done')
    expect(result.current.mods[1].checkingStatus).toBe('done')
  })
})
