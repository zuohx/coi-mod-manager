import { useCallback, useState } from 'react'

import { createApiService } from './api-service'
import type { ChangelogEntry, ModRecord } from '@/shared/types/api'

const apiService = createApiService()

export function useChangelog() {
  const [changelogModalMod, setChangelogModalMod] = useState<ModRecord | null>(null)
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([])
  const [changelogLoading, setChangelogLoading] = useState(false)
  const [changelogError, setChangelogError] = useState<string | null>(null)

  const openChangelogFor = useCallback(async (mod: ModRecord) => {
    if (!mod.url) return
    setChangelogModalMod(mod)
    setChangelogError(null)
    if (mod.changelogEntries && mod.changelogEntries.length > 0) {
      setChangelogEntries(mod.changelogEntries)
      setChangelogLoading(false)
      return
    }
    setChangelogEntries([])
    setChangelogLoading(true)
    try {
      const entries = await apiService.fetchChangelog(mod.url)
      setChangelogEntries(entries)
    } catch (e) {
      setChangelogError(e instanceof Error ? e.message : String(e))
    } finally {
      setChangelogLoading(false)
    }
  }, [])

  const closeChangelog = useCallback(() => {
    setChangelogModalMod(null)
    setChangelogEntries([])
    setChangelogError(null)
  }, [])

  return {
    changelogModalMod,
    changelogEntries,
    changelogLoading,
    changelogError,
    openChangelogFor,
    closeChangelog,
  }
}
