import type { ManifestSummary } from '@/domain/mod/types'
import { parseManifest } from '@/domain/mod/parse-manifest'
import type { Result } from '@/shared/lib/result'
import { ok, err } from '@/shared/lib/result'

export async function readManifestFile(fileHandle: FileSystemFileHandle): Promise<Result<ManifestSummary, Error>> {
  try {
    const file = await fileHandle.getFile()
    const text = await file.text()
    return parseManifest(text)
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
