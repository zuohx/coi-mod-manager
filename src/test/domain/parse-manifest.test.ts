import { describe, it, expect } from 'vitest'
import { parseManifest } from '@/domain/mod/parse-manifest'
import type { ManifestSummary } from '../domain/mod/types'

describe('parseManifest', () => {
  it('should parse valid manifest.json', () => {
    const manifest = {
      id: 'test-mod',
      version: '1.0.0',
      displayName: 'Test Mod',
      authors: ['Author1']
    }

    const result = parseManifest(JSON.stringify(manifest))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('test-mod')
      expect(result.value.version).toBe('1.0.0')
      expect(result.value.displayName).toBe('Test Mod')
      expect(result.value.authors).toEqual(['Author1'])
    }
  })

  it('should return error for invalid JSON', () => {
    const result = parseManifest('invalid json')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error)
    }
  })

  it('should return error for missing required fields', () => {
    const manifest = {
      id: 'test-mod'
      // missing version, displayName, authors
    }

    const result = parseManifest(JSON.stringify(manifest))

    expect(result.ok).toBe(false)
  })
})
