import type { ManifestSummary, HubCandidate, ModStatusRow } from './types'

export function matchMod(local: ManifestSummary, candidates: HubCandidate[]): ModStatusRow {
  // 1. 优先精确匹配
  const exactMatch = candidates.find(c => c.exact)
  if (exactMatch) {
    return {
      local,
      remote: exactMatch,
      matchStatus: 'exact',
      updateStatus: 'unknown' // 需要版本比较后才能确定
    }
  }

  // 2. 无精确匹配，返回候选列表
  if (candidates.length > 0) {
    return {
      local,
      candidates,
      matchStatus: 'candidate_required',
      updateStatus: 'unknown'
    }
  }

  // 3. 无匹配
  return {
    local,
    matchStatus: 'unmatched',
    updateStatus: 'unknown'
  }
}
