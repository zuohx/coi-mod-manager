import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/features/mod-status/model/use-mod-scan', () => ({
  useModScan: vi.fn(),
}))

vi.mock('@/adapters/platform/open-directory', () => ({
  openDirectoryPath: vi.fn(),
}))

import { ModStatusPage } from '@/features/mod-status/ui/ModStatusPage'
import { useModScan } from '@/features/mod-status/model/use-mod-scan'
import { openDirectoryPath } from '@/adapters/platform/open-directory'

describe('ModStatusPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Mock window.matchMedia for theme detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {}
      return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value }),
        removeItem: vi.fn((key: string) => { delete store[key] }),
        clear: vi.fn(() => { store = {} }),
      }
    })()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  })

  it('should show scan and check-update buttons', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: null,
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByRole('button', { name: /扫描本地/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /检查更新/i })).toBeInTheDocument()
  })

  it('should show working directory when path is set', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Games\\Steam\\Captain of Industry\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(
      screen.getByDisplayValue(/C:\\Games\\Steam\\Captain of Industry\\Mods/i),
    ).toBeInTheDocument()
  })

  it('should open the working directory when open-folder button is clicked', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    fireEvent.click(screen.getByRole('button', { name: /打开目录/i }))

    expect(openDirectoryPath).toHaveBeenCalledWith('C:\\Mods')
  })

  it('should enable scan button when directory is selected', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByRole('button', { name: /扫描本地/i })).toBeEnabled()
  })

  it('should show table with correct columns', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '1.2 MB',
          remoteVersion: '1.2.0',
          url: 'https://hub.coigame.com/Mod/1/Test-Mod',
          downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
          status: 'update_available',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByRole('columnheader', { name: '#' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'MOD' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /本地版本/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^大小$/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /HUB 版本/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /链接/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /状态/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /操作/i })).toBeInTheDocument()
  })

  it('should show mod data in table rows', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '1.2 MB',
          remoteVersion: '1.2.0',
          url: 'https://hub.coigame.com/Mod/1/Test-Mod',
          downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
          status: 'update_available',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByText('Test Mod')).toBeInTheDocument()
    expect(screen.getByText('test-mod')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getByText('1.2 MB')).toBeInTheDocument()
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getAllByText(/可更新/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Hub/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^更新$/ })).toBeEnabled()
  })

  it('should show size loading spinner in the size column while checking', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '-',
          checkingStatus: 'checking',
          status: 'unknown',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 1,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByLabelText('正在加载 Mod 大小')).toBeInTheDocument()
  })

  it('should call scan when scan button is clicked', () => {
    const mockScan = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useModScan).mockReturnValue({
      mods: [],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: null,
      scan: mockScan,
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    fireEvent.click(screen.getByRole('button', { name: /扫描本地/i }))
    expect(mockScan).toHaveBeenCalledOnce()
  })

  it('should call upgrade when update button is clicked', () => {
    const mockUpgrade = vi.fn()
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '1.2 MB',
          remoteVersion: '1.2.0',
          url: 'https://hub.coigame.com/Mod/1/Test-Mod',
          downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
          status: 'update_available',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: mockUpgrade,
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    fireEvent.click(screen.getByRole('button', { name: /^更新$/i }))
    expect(mockUpgrade).toHaveBeenCalledOnce()
  })

  it('should enable update button when status is update_available and hub url exists', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '1.2 MB',
          remoteVersion: '1.2.0',
          url: 'https://hub.coigame.com/Mod/1/Test-Mod',
          downloadUrl: undefined,
          status: 'update_available',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByRole('button', { name: /^更新$/i })).toBeEnabled()
  })

  it('should show progress details when a mod is upgrading', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'test-mod',
          displayName: 'Test Mod',
          version: '1.0.0',
          sizeText: '1.2 MB',
          remoteVersion: '1.2.0',
          url: 'https://hub.coigame.com/Mod/1/Test-Mod',
          downloadUrl: 'https://hub.coigame.com/Mod/DownloadMod/1',
          status: 'update_available',
          manifestPath: 'C:\\Mods\\test-mod\\manifest.json',
          installDir: 'C:\\Mods\\test-mod',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(['test-mod']),
      upgradeProgressMap: {
        'test-mod': {
          phase: 'downloading',
          message: '正在下载更新包',
          percent: 42,
        },
      },
      upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    const row = screen.getByRole('row', { name: /Test Mod/i })
    expect(row).toHaveTextContent(/正在下载更新包/)
    expect(row).toHaveTextContent(/42%/)
  })

  it('should show stats cards when mods exist', () => {
    vi.mocked(useModScan).mockReturnValue({
      mods: [
        {
          id: 'a',
          displayName: 'A',
          version: '1.0.0',
          sizeText: '1 MB',
          status: 'up_to_date',
          manifestPath: '',
          installDir: '',
        },
        {
          id: 'b',
          displayName: 'B',
          version: '1.0.0',
          sizeText: '1 MB',
          remoteVersion: '2.0.0',
          status: 'update_available',
          manifestPath: '',
          installDir: '',
          url: 'https://hub.coigame.com/Mod/1/B',
        },
      ],
      scanning: false,
      checkingCount: 0,
      upgradingIds: new Set(),
      upgradeProgressMap: {},
            upgradeResults: {},
      error: null,
      dirPath: 'C:\\Mods',
      scan: vi.fn(),
      checkUpdates: vi.fn(),
      upgrade: vi.fn(),
      recheck: vi.fn(),
      forceUpgradeAll: vi.fn(),
    })

    render(<ModStatusPage />)

    expect(screen.getByText('TOTAL MODS')).toBeInTheDocument()
    expect(screen.getByText('NEED UPDATE')).toBeInTheDocument()
  })
})
