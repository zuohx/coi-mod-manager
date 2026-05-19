import { describe, it, expect } from 'vitest'
import { matchMod } from '@/domain/mod/match-mod'
import type { ManifestSummary, HubCandidate } from '@/domain/mod/types'

describe('matchMod', () => {
  it('should return exact match when title matches displayName', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const candidates: HubCandidate[] = [
      { remoteId: '1', title: 'Test Mod', exact: true, score: 1.0 },
      { remoteId: '2', title: 'Test Mod 2', exact: false, score: 0.8 }
    ]

    const result = matchMod(local, candidates)

    expect(result.matchStatus).toBe('exact')
    expect(result.remote).toEqual(candidates[0])
  })

  it('should return candidate_required when no exact match', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const candidates: HubCandidate[] = [
      { remoteId: '2', title: 'Test Mod 2', exact: false, score: 0.8 }
    ]

    const result = matchMod(local, candidates)

    expect(result.matchStatus).toBe('candidate_required')
    expect(result.candidates).toEqual(candidates)
  })

  it('should return unmatched when no candidates', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const candidates: HubCandidate[] = []

    const result = matchMod(local, candidates)

    expect(result.matchStatus).toBe('unmatched')
  })
})
