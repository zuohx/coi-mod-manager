import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * TS/Rust 双实现契约测试。
 *
 * server/mod-api.ts（Node）与 src-tauri/src/commands/hub/parser.rs（Rust）
 * 实现了同一套 Hub HTML 解析逻辑。本测试用 fixtures/hub/ 下的共享 fixture 与
 * golden 文件锁定 Node 端行为；Rust 端在 parser.rs 的 contract 测试中读取同一批
 * 文件断言相同结果。两端必须保持一致——修改解析行为时同步更新两端与 golden。
 */

function fixture(name: string): string {
  return path.resolve(process.cwd(), 'fixtures/hub', name)
}

function readFixture(name: string): string {
  return readFileSync(fixture(name), 'utf8')
}

function readGolden<T>(name: string): T {
  return JSON.parse(readFixture(name)) as T
}

interface DetailGolden {
  downloadUrl: string
  sizeText: string
}

interface ChangelogGolden {
  version: string
  date: string
  content: string
}

describe('hub parser contract (Node side)', () => {
  it('extracts the download url matching the golden file', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const html = readFixture('detail.html')
    const golden = readGolden<DetailGolden>('detail.expected.json')

    const result = (modApi as { __test: { extractDownloadUrlFromDetailHtml(html: string): string | undefined } }).__test
      .extractDownloadUrlFromDetailHtml(html)

    expect(result).toBe(golden.downloadUrl)
  })

  it('extracts the file size matching the golden file', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const html = readFixture('detail.html')
    const golden = readGolden<DetailGolden>('detail.expected.json')

    const result = (modApi as { __test: { extractFileSizeFromDetailHtml(html: string): string | undefined } }).__test
      .extractFileSizeFromDetailHtml(html)

    expect(result).toBe(golden.sizeText)
  })

  it('extracts changelog entries matching the golden file', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const html = readFixture('detail.html')
    const golden = readGolden<ChangelogGolden[]>('changelog.expected.json')

    const result = (modApi as { __test: { extractChangelogFromHtml(html: string): ChangelogGolden[] } }).__test
      .extractChangelogFromHtml(html)

    expect(result).toEqual(golden)
  })
})
