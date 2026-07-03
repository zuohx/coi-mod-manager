import { useMemo, useState } from 'react'

import type { ModRecord } from '@/shared/types/api'

export type StatusFilter = 'all' | 'outdated' | 'updated' | 'unknown'

export const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'outdated', label: '可更新' },
  { value: 'updated', label: '已最新' },
  { value: 'unknown', label: '未知' },
]

export const statusConfig: Record<string, { text: string; pillClass: string; filterKey: StatusFilter }> = {
  up_to_date: { text: '已最新', pillClass: 'status-updated', filterKey: 'updated' },
  update_available: { text: '可更新', pillClass: 'status-outdated', filterKey: 'outdated' },
  unknown: { text: '未知', pillClass: 'status-unknown', filterKey: 'unknown' },
}

export function matchesFilter(mod: ModRecord, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const key = statusConfig[mod.status]?.filterKey ?? 'unknown'
  return key === filter
}

export function useModFilters({
  mods,
  scanning,
  error,
  checkingCount,
}: {
  mods: ModRecord[]
  scanning: boolean
  error: Error | null
  checkingCount: number
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const stats = useMemo(() => {
    let upToDate = 0
    let needUpdate = 0
    let unknown = 0
    for (const mod of mods) {
      if (mod.status === 'up_to_date') upToDate++
      else if (mod.status === 'update_available') needUpdate++
      else unknown++
    }
    return { total: mods.length, upToDate, needUpdate, unknown }
  }, [mods])

  const filteredMods = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return mods.filter((mod) => {
      if (!matchesFilter(mod, statusFilter)) return false
      if (!kw) return true
      return mod.displayName.toLowerCase().includes(kw) || mod.id.toLowerCase().includes(kw)
    })
  }, [mods, search, statusFilter])

  const outdatedMods = useMemo(() => mods.filter((m) => m.status === 'update_available'), [mods])

  const checkedCount = useMemo(() => mods.filter((m) => m.checkingStatus === 'done').length, [mods])

  const notice = useMemo(() => {
    if (scanning && mods.length === 0) {
      return { variant: 'info' as const, text: '正在扫描本地 Mod 目录…' }
    }
    if (error) {
      return { variant: 'warning' as const, text: error.message }
    }
    if (mods.length === 0) {
      return { variant: 'info' as const, text: '未发现 Mod，请确认工作目录或点击「扫描本地」。' }
    }
    if (checkingCount > 0) {
      return {
        variant: 'info' as const,
        text: `正在并行检查 Mod 版本（${checkedCount}/${stats.total}，${checkingCount} 路并发）…`,
      }
    }
    if (stats.unknown > 0 && stats.needUpdate === 0) {
      return {
        variant: 'info' as const,
        text: `共 ${stats.total} 个 Mod，点击「检查更新」以查询 Hub 版本。`,
      }
    }
    if (stats.needUpdate > 0) {
      return {
        variant: 'warning' as const,
        text: `检查完成，共 ${stats.total} 个 Mod。其中 ${stats.needUpdate} 个可更新。`,
      }
    }
    return {
      variant: 'success' as const,
      text: `所有 ${stats.total} 个 Mod 均已是最新版本`,
    }
  }, [scanning, mods.length, error, stats, checkingCount, checkedCount])

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    stats,
    filteredMods,
    outdatedMods,
    checkedCount,
    notice,
  }
}
