export type ManifestSummary = {
  id: string
  version: string
  displayName: string
  authors: string[]
}

export type HubCandidate = {
  remoteId: string
  title: string
  version?: string
  exact: boolean
  score: number
}

export type MatchStatus = 'exact' | 'candidate_required' | 'unmatched'

export type UpdateStatus = 'up_to_date' | 'update_available' | 'unknown'

export type ModStatusRow = {
  local: ManifestSummary
  remote?: HubCandidate
  candidates?: HubCandidate[]
  matchStatus: MatchStatus
  updateStatus: UpdateStatus
}
