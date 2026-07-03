import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type {
  IModApiService,
  ModRecord,
  ScanModsResponse,
  UpgradeEvent,
  UpgradeResult,
} from '@/shared/types/api'

// Mock the entire api-service module
const mockLocalScan = vi.fn<() => Promise<ScanModsResponse>>()
const mockCheckMod = vi.fn<(installDir: string) => Promise<ModRecord>>()
const mockStreamUpgrade =
  vi.fn<
    (
      installDir: string,
      downloadUrl: string,
      hubPageUrl: string | undefined,
      onEvent: (event: UpgradeEvent) => void,
    ) => Promise<ScanModsResponse>
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
  installDir: 'C:\\Mods\\mod-1',
}

const enrichedModFixture: ModRecord = {
  ...localModFixture,
  sizeText: '1.2 MB',
  sizeLoading: false,
  remoteVersion: '1.2.0',
  url: 'https://hub.coigame.com/Mod/1/Mod-1',
  downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
  status: 'update_available',
}

const localModFixture2: ModRecord = {
  id: 'mod-2',
  version: '2.0.0',
  displayName: 'Mod 2',
  sizeText: '-',
  sizeLoading: true,
  remoteVersion: undefined,
  url: undefined,
  downloadUrl: undefined,
  status: 'unknown',
  manifestPath: 'C:\\Mods\\mod-2\\manifest.json',
  installDir: 'C:\\Mods\\mod-2',
}

const enrichedModFixture2: ModRecord = {
  ...localModFixture2,
  sizeText: '2.5 MB',
  sizeLoading: false,
  remoteVersion: '2.1.0',
  url: 'https://hub.coigame.com/Mod/2/Mod-2',
  downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/2',
  status: 'update_available',
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
      mods: [localModFixture],
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
      mods: [localModFixture],
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)
    mockStreamUpgrade.mockImplementation(
      async (
        _installDir: string,
        _downloadUrl: string,
        _hubPageUrl: string | undefined,
        onEvent?: (event: UpgradeEvent) => void,
      ): Promise<ScanModsResponse> => {
        // Emit progress event (new format: { type: 'progress', progress: {...} })
        onEvent?.({
          type: 'progress',
          progress: {
            phase: 'downloading',
            message: '正在下载更新包',
            percent: 48,
          },
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
              status: 'up_to_date',
            },
          ],
        }
      },
    )

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
      expect.any(Function),
    )
    expect(result.current.mods[0].version).toBe('1.2.0')
  })

  it('should fallback to hub url when direct download url is missing', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture],
    })
    mockCheckMod.mockResolvedValue({
      ...enrichedModFixture,
      downloadUrl: undefined,
    })
    mockStreamUpgrade.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [],
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
      expect.any(Function),
    )
  })

  it('should expose upgrade progress while upgrading', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture],
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)
    let capturedEvent: UpgradeEvent | undefined
    mockStreamUpgrade.mockImplementation(
      async (
        _installDir: string,
        _downloadUrl: string,
        _hubPageUrl: string | undefined,
        onEvent?: (event: UpgradeEvent) => void,
      ): Promise<ScanModsResponse> => {
        const event: UpgradeEvent = {
          type: 'progress',
          progress: {
            phase: 'downloading',
            message: '正在下载更新包',
            percent: 52,
          },
        }
        capturedEvent = event
        onEvent?.(event)
        return {
          dirPath: 'C:\\Mods',
          mods: [],
        }
      },
    )

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
        { ...localModFixture, id: 'mod-b', displayName: 'Mod B', installDir: 'C:\\Mods\\mod-b' },
      ],
    })

    const checkResolveFns: Array<(v: ModRecord) => void> = []
    mockCheckMod.mockImplementation(
      () => new Promise<ModRecord>((resolve) => checkResolveFns.push(resolve)),
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

  it('should isolate upgrade errors per mod without affecting other mods', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [
        { ...localModFixture, id: 'mod-a', displayName: 'Mod A', installDir: 'C:\\Mods\\mod-a' },
        { ...localModFixture2, id: 'mod-b', displayName: 'Mod B', installDir: 'C:\\Mods\\mod-b' },
      ],
    })
    mockCheckMod.mockImplementation(async (installDir: string) => {
      if (installDir === 'C:\\Mods\\mod-a') {
        return {
          ...enrichedModFixture,
          id: 'mod-a',
          displayName: 'Mod A',
          installDir: 'C:\\Mods\\mod-a',
        }
      }
      return {
        ...enrichedModFixture2,
        id: 'mod-b',
        displayName: 'Mod B',
        installDir: 'C:\\Mods\\mod-b',
      }
    })
    // mod-a fails, mod-b succeeds
    mockStreamUpgrade.mockImplementation(
      async (
        installDir: string,
        _downloadUrl: string,
        _hubPageUrl: string | undefined,
        _onEvent?: (event: UpgradeEvent) => void,
      ): Promise<ScanModsResponse> => {
        if (installDir === 'C:\\Mods\\mod-a') {
          throw new Error('Network timeout for mod-a')
        }
        return {
          dirPath: 'C:\\Mods',
          mods: [
            {
              ...enrichedModFixture2,
              id: 'mod-b',
              displayName: 'Mod B',
              installDir: 'C:\\Mods\\mod-b',
              version: '2.1.0',
              status: 'up_to_date',
            },
          ],
        }
      },
    )

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.checkUpdates()
    })

    // Upgrade mod-a (should fail)
    await act(async () => {
      await result.current.upgrade(result.current.mods.find((m) => m.id === 'mod-a')!)
    })

    // mod-a should have upgradeError set
    const modA = result.current.mods.find((m) => m.id === 'mod-a')
    expect(modA?.upgradeError).toBe('Network timeout for mod-a')
    expect(result.current.upgradeResults['mod-a']).toEqual({
      ok: false,
      error: 'Network timeout for mod-a',
    })

    // Upgrade mod-b (should succeed)
    await act(async () => {
      await result.current.upgrade(result.current.mods.find((m) => m.id === 'mod-b')!)
    })

    // mod-b should NOT have upgradeError
    const modB = result.current.mods.find((m) => m.id === 'mod-b')
    expect(modB?.upgradeError).toBeUndefined()
    expect(modB?.version).toBe('2.1.0')
    expect(result.current.upgradeResults['mod-b']).toEqual({ ok: true })

    // mod-a error should still be there (not affected by mod-b success)
    const modAAfter = result.current.mods.find((m) => m.id === 'mod-a')
    expect(modAAfter?.upgradeError).toBe('Network timeout for mod-a')

    // Global error should NOT be set (errors are per-mod now)
    expect(result.current.error).toBe(null)
  })

  it('should track concurrent upgrades independently', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [
        { ...localModFixture, id: 'mod-a', displayName: 'Mod A', installDir: 'C:\\Mods\\mod-a' },
        { ...localModFixture2, id: 'mod-b', displayName: 'Mod B', installDir: 'C:\\Mods\\mod-b' },
      ],
    })
    mockCheckMod.mockImplementation(async (installDir: string) => {
      if (installDir === 'C:\\Mods\\mod-a') {
        return {
          ...enrichedModFixture,
          id: 'mod-a',
          displayName: 'Mod A',
          installDir: 'C:\\Mods\\mod-a',
        }
      }
      return {
        ...enrichedModFixture2,
        id: 'mod-b',
        displayName: 'Mod B',
        installDir: 'C:\\Mods\\mod-b',
      }
    })

    const upgradePromises: Array<() => void> = []
    mockStreamUpgrade.mockImplementation(
      async (
        _installDir: string,
        _downloadUrl: string,
        _hubPageUrl: string | undefined,
        onEvent?: (event: UpgradeEvent) => void,
      ): Promise<ScanModsResponse> => {
        return new Promise<ScanModsResponse>((resolve) => {
          onEvent?.({
            type: 'progress',
            progress: { phase: 'downloading', message: 'downloading', percent: 50 },
          })
          upgradePromises.push(() => {
            resolve({
              dirPath: 'C:\\Mods',
              mods: [{ ...enrichedModFixture, version: '1.2.0', status: 'up_to_date' }],
            })
          })
        })
      },
    )

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.checkUpdates()
    })

    // Start both upgrades (they run concurrently)
    let p1: Promise<UpgradeResult>
    let p2: Promise<UpgradeResult>
    await act(async () => {
      p1 = result.current.upgrade(result.current.mods.find((m) => m.id === 'mod-a')!)
      p2 = result.current.upgrade(result.current.mods.find((m) => m.id === 'mod-b')!)
      await Promise.resolve()
    })

    // Both should be in upgradingIds
    expect(result.current.upgradingIds.size).toBe(2)

    // Resolve both
    await act(async () => {
      upgradePromises.forEach((resolve) => resolve())
      await Promise.all([p1!, p2!])
    })

    // Both should be done
    expect(result.current.upgradingIds.size).toBe(0)
    expect(result.current.upgradeProgressMap).toEqual({})
  })

  it('should report per-mod failure through forceUpgradeAll onModDone', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [
        { ...localModFixture, id: 'mod-a', displayName: 'Mod A', installDir: 'C:\\Mods\\mod-a' },
        { ...localModFixture2, id: 'mod-b', displayName: 'Mod B', installDir: 'C:\\Mods\\mod-b' },
      ],
    })
    mockCheckMod.mockImplementation(async (installDir: string) => {
      if (installDir === 'C:\\Mods\\mod-a') {
        return {
          ...enrichedModFixture,
          id: 'mod-a',
          displayName: 'Mod A',
          installDir: 'C:\\Mods\\mod-a',
        }
      }
      return {
        ...enrichedModFixture2,
        id: 'mod-b',
        displayName: 'Mod B',
        installDir: 'C:\\Mods\\mod-b',
      }
    })
    // mod-a fails (streamUpgrade rejects), mod-b succeeds
    mockStreamUpgrade.mockImplementation(
      async (
        installDir: string,
        _downloadUrl: string,
        _hubPageUrl: string | undefined,
        _onEvent?: (event: UpgradeEvent) => void,
      ): Promise<ScanModsResponse> => {
        if (installDir === 'C:\\Mods\\mod-a') {
          throw new Error('Network timeout for mod-a')
        }
        return {
          dirPath: 'C:\\Mods',
          mods: [
            {
              ...enrichedModFixture2,
              id: 'mod-b',
              displayName: 'Mod B',
              installDir: 'C:\\Mods\\mod-b',
              version: '2.1.0',
              status: 'up_to_date',
            },
          ],
        }
      },
    )

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.checkUpdates()
    })

    const doneResults = new Map<string, boolean>()
    await act(async () => {
      await result.current.forceUpgradeAll(result.current.mods, undefined, (mod, ok) => {
        doneResults.set(mod.id, ok)
      })
    })

    // The failed mod must be reported as failed, not falsely reported as success.
    expect(doneResults.get('mod-a')).toBe(false)
    expect(doneResults.get('mod-b')).toBe(true)
    expect(result.current.upgradeResults['mod-a']?.ok).toBe(false)
    expect(result.current.upgradeResults['mod-b']?.ok).toBe(true)
  })

  it('should report failure through forceUpgradeAll upgrade return value', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture],
    })
    mockCheckMod.mockResolvedValue(enrichedModFixture)
    mockStreamUpgrade.mockRejectedValue(new Error('boom'))

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.checkUpdates()
    })

    let returned: { ok: boolean; error?: string } | undefined
    await act(async () => {
      returned = await result.current.upgrade(result.current.mods[0])
    })

    expect(returned).toEqual({ ok: false, error: 'boom' })
  })

  it('should set upgradeError when mod has no download link', async () => {
    mockLocalScan.mockResolvedValue({
      dirPath: 'C:\\Mods',
      mods: [localModFixture],
    })
    mockCheckMod.mockResolvedValue({
      ...localModFixture,
      sizeText: '1.2 MB',
      sizeLoading: false,
      status: 'unknown',
      checkingStatus: 'done',
      // No url, no downloadUrl
    })

    const { useModScan } = await import('@/features/mod-status/model/use-mod-scan')
    const { result } = renderHook(() => useModScan())

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.checkUpdates()
    })

    // Try to upgrade a mod with no download link
    await act(async () => {
      await result.current.upgrade(result.current.mods[0])
    })

    // Should have per-mod error
    expect(result.current.mods[0].upgradeError).toBe('当前 Mod 没有可用的升级下载链接')
    expect(result.current.upgradeResults['mod-1']).toEqual({
      ok: false,
      error: '当前 Mod 没有可用的升级下载链接',
    })
    // Global error should NOT be set
    expect(result.current.error).toBe(null)
    // streamUpgrade should NOT have been called
    expect(mockStreamUpgrade).not.toHaveBeenCalled()
  })
})
