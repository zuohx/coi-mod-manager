import { describe, it, expect, vi } from 'vitest'
import { searchCoiHub } from '@/adapters/cohub/cohub-client'

describe('searchCoiHub', () => {
  it('should return candidates when search succeeds', async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        results: [
          { id: '1', title: 'Test Mod', version: '1.0.0' }
        ]
      })
    })

    const result = await searchCoiHub('Test Mod')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0].title).toBe('Test Mod')
    }
  })

  it('should return error when fetch fails', async () => {
    // Mock fetch to throw
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await searchCoiHub('Test Mod')

    expect(result.ok).toBe(false)
  })

  it('should map results to HubCandidate', async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        results: [
          { id: '1', title: 'Test Mod', version: '1.0.0' }
        ]
      })
    })

    const result = await searchCoiHub('Test Mod')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]).toHaveProperty('remoteId')
      expect(result.value[0]).toHaveProperty('exact')
      expect(result.value[0]).toHaveProperty('score')
    }
  })
})
