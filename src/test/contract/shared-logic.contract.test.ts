import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { compareVersions, normalizeRemoteVersion } from '../../../server/mods.ts'
import { decodeHtmlEntities, normalizeName, normalizeWhitespace, stripTags } from '../../../server/util.ts'

function fixture(name: string): string {
  return path.resolve(process.cwd(), 'fixtures/contract', name)
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(fixture(name), 'utf8')) as T
}

type VersionCompareCase = {
  left: string
  right: string
  sign: -1 | 0 | 1
}

type NormalizeRemoteCase = {
  input?: string | null
  output: string | null
}

type TextCase = {
  in: string
  out: string
}

describe('shared pure logic contracts', () => {
  it('matches version comparison fixtures', () => {
    const cases = readFixture<VersionCompareCase[]>('version-compare.json')
    for (const { left, right, sign } of cases) {
      expect(Math.sign(compareVersions(left, right))).toBe(sign)
    }
  })

  it('matches remote version normalization fixtures', () => {
    const cases = readFixture<NormalizeRemoteCase[]>('normalize-remote-version.json')
    for (const { input, output } of cases) {
      const value = normalizeRemoteVersion(input ?? undefined)
      expect(value ?? null).toBe(output)
    }
  })

  it('matches text normalization fixtures', () => {
    const cases = readFixture<{
      decodeHtmlEntities: TextCase[]
      stripTags: TextCase[]
      normalizeWhitespace: TextCase[]
      normalizeName: TextCase[]
    }>('text-normalize.json')

    for (const { in: input, out } of cases.decodeHtmlEntities) {
      expect(decodeHtmlEntities(input)).toBe(out)
    }
    for (const { in: input, out } of cases.stripTags) {
      expect(stripTags(input)).toBe(out)
    }
    for (const { in: input, out } of cases.normalizeWhitespace) {
      expect(normalizeWhitespace(input)).toBe(out)
    }
    for (const { in: input, out } of cases.normalizeName) {
      expect(normalizeName(input)).toBe(out)
    }
  })
})
