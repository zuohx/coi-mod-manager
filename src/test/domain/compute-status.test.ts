import { describe, it, expect } from 'vitest'
import { computeStatus } from '@/domain/mod/compute-status'
import type { ManifestSummary, HubCandidate } from '@/domain/mod/types'

describe('computeStatus', () => {
  it('should return up_to_date when local version is newer or equal', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const remote: HubCandidate = {
      remoteId: '1',
      title: 'Test Mod',
      version: '1.0.0',
      exact: true,
      score: 1.0
    }

    const result = computeStatus(local, remote)

    expect(result.updateStatus).toBe('up_to_date')
  })

  it('should return update_available when remote version is newer', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const remote: HubCandidate = {
      remoteId: '1',
      title: 'Test Mod',
      version: '1.1.0',
      exact: true,
      score: 1.0
    }

    const result = computeStatus(local, remote)

    expect(result.updateStatus).toBe('update_available')
  })

  it('should return unknown when version is missing or invalid', () => {
    const local: ManifestSummary = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const remote: HubCandidate = {
      remoteId: '1',
      title: 'Test Mod',
      exact: true,
      score: 1.0
    }

    const result = computeStatus(local, remote)

    expect(result.updateStatus).toBe('unknown')
  })
})
