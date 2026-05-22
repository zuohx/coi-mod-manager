import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { ModRecord, UpgradeProgress, IModApiService } from '@/shared/types/api'
import { createApiService } from './api-service'

const CHECK_CONCURRENCY = 10
const UPGRADE_CONCURRENCY = 10

export interface UseModScanReturn {
  mods: ModRecord[]
  scanning: boolean
  checkingCount: number
  upgradingIds: Set<string>
  upgradeProgressMap: Record<string, UpgradeProgress>
  error: Error | null
  dirPath: string | null
  scan: () => Promise<void>
  checkUpdates: () => Promise<void>
  upgrade: (mod: ModRecord) => Promise<void>
  recheck: (mod: ModRecord) => Promise<void>
  forceUpgradeAll: (mods: ModRecord[], onModStart?: (mod: ModRecord) => void, onModDone?: (mod: ModRecord, ok: boolean) => void) => Promise<void>
}

function sortMods(mods: ModRecord[]): ModRecord[] {
  return [...mods].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Mod 扫描状态管理 Hook。
 *
 * @param service 可选的 API 服务实例。不传则通过 createApiService() 自动选择。
 *                注入主要用于测试场景。
 */
export function useModScan(service?: IModApiService): UseModScanReturn {
  const api = useMemo(() => service ?? createApiService(), [service])

  const [mods, setMods] = useState<ModRecord[]>([])
  const [scanning, setScanning] = useState(false)
  const [checkingCount, setCheckingCount] = useState(0)
  const [upgradingIds, setUpgradingIds] = useState<Set<string>>(new Set())
  const [upgradeProgressMap, setUpgradeProgressMap] = useState<Record<string, UpgradeProgress>>({})
  const [error, setError] = useState<Error | null>(null)
  const [dirPath, setDirPath] = useState<string | null>(null)
  const abortRef = useRef(false)
  const modsRef = useRef<ModRecord[]>([])

  useEffect(() => {
    modsRef.current = mods
  }, [mods])

  const doLocalScan = useCallback(async () => {
    abortRef.current = false
    setScanning(true)
    setError(null)
    setCheckingCount(0)

    try {
      const local = await api.localScan()
      if (abortRef.current) return

      setDirPath(local.dirPath)
      setMods(
        sortMods(
          local.mods.map((m) => ({
            ...m,
            status: 'unknown' as const,
            checkingStatus: 'pending' as const
          }))
        )
      )
    } catch (e) {
      if (!abortRef.current) {
        setError(e instanceof Error ? e : new Error(String(e)))
      }
    } finally {
      setScanning(false)
    }
  }, [api])

  const doCheckUpdates = useCallback(async (initialMods?: ModRecord[]) => {
    abortRef.current = false
    setCheckingCount(0)
    setError(null)

    const currentMods = initialMods ?? modsRef.current
    if (currentMods.length === 0) {
      return
    }

    await mapWithConcurrency(currentMods, CHECK_CONCURRENCY, async (mod) => {
      if (abortRef.current) return mod

      setCheckingCount((c) => c + 1)
      setMods((prev) =>
        prev.map((m) =>
          m.id === mod.id ? { ...m, checkingStatus: 'checking' as const } : m
        )
      )

      try {
        const enriched = await api.checkMod(mod.installDir)
        if (abortRef.current) return mod

        setMods((prev) =>
          sortMods(
            prev.map((m) =>
              m.id === mod.id
                ? { ...m, ...enriched, checkingStatus: 'done' as const }
                : m
            )
          )
        )
      } catch {
        if (abortRef.current) return mod
        setMods((prev) =>
          prev.map((m) =>
            m.id === mod.id
              ? { ...m, status: 'unknown' as const, checkingStatus: 'done' as const }
              : m
          )
        )
      } finally {
        setCheckingCount((c) => c - 1)
      }

      return mod
    })

    setCheckingCount(0)
  }, [api])

  const scan = useCallback(async () => {
    await doLocalScan()
  }, [doLocalScan])

  const checkUpdates = useCallback(async () => {
    await doCheckUpdates()
  }, [doCheckUpdates])

  const upgrade = useCallback(async (mod: ModRecord) => {
    const upgradeSource = mod.downloadUrl ?? mod.url

    if (!upgradeSource) {
      setError(new Error('当前 Mod 没有可用的升级下载链接'))
      return
    }

    setUpgradingIds((prev) => new Set(prev).add(mod.id))
    setUpgradeProgressMap((prev) => ({
      ...prev,
      [mod.id]: { phase: 'resolving', message: '准备升级…', percent: 0 }
    }))
    setError(null)

    try {
      const result = await api.streamUpgrade(
        mod.installDir,
        upgradeSource,
        mod.url,
        (event) => {
          if (event.type === 'progress') {
            setUpgradeProgressMap((prev) => ({ ...prev, [mod.id]: event.progress }))
          }
        }
      )

      // Merge: apply server results for this mod, keep others intact
      const upgradedMod = result.mods.find((m) => m.id === mod.id)
      if (upgradedMod) {
        setMods((prev) =>
          sortMods(prev.map((m) => (m.id === mod.id ? { ...m, ...upgradedMod } : m)))
        )
      }
      setDirPath(result.dirPath)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setUpgradingIds((prev) => {
        const next = new Set(prev)
        next.delete(mod.id)
        return next
      })
      setUpgradeProgressMap((prev) => {
        const next = { ...prev }
        delete next[mod.id]
        return next
      })
    }
  }, [api])

  const recheck = useCallback(async (mod: ModRecord) => {
    setMods((prev) =>
      prev.map((m) =>
        m.id === mod.id ? { ...m, checkingStatus: 'checking' as const } : m
      )
    )

    try {
      const enriched = await api.checkMod(mod.installDir)
      setMods((prev) =>
        sortMods(
          prev.map((m) =>
            m.id === mod.id
              ? { ...m, ...enriched, checkingStatus: 'done' as const }
              : m
          )
        )
      )
    } catch {
      setMods((prev) =>
        prev.map((m) =>
          m.id === mod.id
            ? { ...m, status: 'unknown' as const, checkingStatus: 'done' as const }
            : m
        )
      )
    }
  }, [api])

  const forceUpgradeAll = useCallback(async (
    targetMods: ModRecord[],
    onModStart?: (mod: ModRecord) => void,
    onModDone?: (mod: ModRecord, ok: boolean) => void
  ) => {
    await mapWithConcurrency(targetMods, UPGRADE_CONCURRENCY, async (mod) => {
      const source = mod.downloadUrl ?? mod.url
      if (!source) {
        onModDone?.(mod, false)
        return
      }

      onModStart?.(mod)
      try {
        await upgrade(mod)
        onModDone?.(mod, true)
      } catch {
        onModDone?.(mod, false)
      }
    })
  }, [upgrade])

  useEffect(() => {
    void (async () => {
      abortRef.current = false
      setScanning(true)
      setError(null)
      setCheckingCount(0)

      try {
        const local = await api.localScan()
        if (abortRef.current) return

        setDirPath(local.dirPath)
        const sortedMods = sortMods(
          local.mods.map((m) => ({
            ...m,
            status: 'unknown' as const,
            checkingStatus: 'pending' as const
          }))
        )
        setMods(sortedMods)
        await doCheckUpdates(sortedMods)
      } catch (e) {
        if (!abortRef.current) {
          setError(e instanceof Error ? e : new Error(String(e)))
        }
      } finally {
        setScanning(false)
      }
    })()

    return () => {
      abortRef.current = true
    }
  }, [api, doLocalScan, doCheckUpdates])

  return { mods, scanning, checkingCount, upgradingIds, upgradeProgressMap, error, dirPath, scan, checkUpdates, upgrade, recheck, forceUpgradeAll }
}
