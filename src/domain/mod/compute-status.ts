import type { ManifestSummary, HubCandidate, ModStatusRow } from './types'
import { compareVersions } from '@/shared/lib/semver'

export function computeStatus(local: ManifestSummary, remote: HubCandidate): ModStatusRow {
  let updateStatus: ModStatusRow['updateStatus'] = 'unknown'

  if (remote.version) {
    const comparison = compareVersions(local.version, remote.version)
    if (comparison >= 0) {
      updateStatus = 'up_to_date'
    } else {
      updateStatus = 'update_available'
    }
  }

  return {
    local,
    remote,
    matchStatus: 'exact', // 假设已经匹配成功
    updateStatus
  }
}
