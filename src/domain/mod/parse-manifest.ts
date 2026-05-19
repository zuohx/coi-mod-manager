import type { ManifestSummary } from './types'
import type { Result } from '../../shared/lib/result'
import { ok, err } from '../../shared/lib/result'

export function parseManifest(jsonString: string): Result<ManifestSummary, Error> {
  try {
    const parsed = JSON.parse(jsonString)

    if (!parsed.id || !parsed.version || !parsed.displayName || !Array.isArray(parsed.authors)) {
      return err(new Error('Missing required fields: id, version, displayName, authors'))
    }

    return ok({
      id: parsed.id,
      version: parsed.version,
      displayName: parsed.displayName,
      authors: parsed.authors
    })
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
