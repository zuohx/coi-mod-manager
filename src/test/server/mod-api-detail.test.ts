import { describe, it, expect, vi } from 'vitest'

describe('mod api detail html extraction', () => {
  it('should read file size from the latest version section', async () => {
    const modApi = await import('../../../server/mod-api.ts')

    const html = `
      <section>
        <span>v0.2.2</span>
        <table>
          <tr><th>File size</th><td>900 KB</td></tr>
        </table>
      </section>
      <section>
        <span>Latest</span>
        <table>
          <tr><th>File size</th><td>1.3 MB</td></tr>
        </table>
      </section>
    `

    const result = (modApi as any).__test.extractFileSizeFromDetailHtml(html)

    expect(result).toBe('1.3 MB')
  })

  it('should fallback to the first file size when no latest marker exists', async () => {
    const modApi = await import('../../../server/mod-api.ts')

    const html = `
      <table>
        <tr><th>File size</th><td>512 KB</td></tr>
      </table>
    `

    const result = (modApi as any).__test.extractFileSizeFromDetailHtml(html)

    expect(result).toBe('512 KB')
  })

  it('should enrich mod size from hub detail page', async () => {
    const modApi = await import('../../../server/mod-api.ts')
    const originalFetch = globalThis.fetch

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/Mod/1/')) {
        return new Response(
          `
            <section>
              <span>Latest</span>
              <table><tr><th>File size</th><td>2.0 MB</td></tr></table>
              <a href="/Mod/DownloadMod/99">Download</a>
            </section>
          `,
          { status: 200 }
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const result = await (modApi as any).__test.enrichMod({
        id: 'demo-mod',
        displayName: 'Demo Mod',
        version: '1.0.0',
        sizeText: '-',
        authors: ['Author'],
        manifestPath: 'C:\\Mods\\demo\\manifest.json',
        installDir: 'C:\\Mods\\demo',
        hubUrl: 'https://hub.coigame.com/Mod/1/Demo-Mod',
        hubVersion: 'v1.1.0'
      })

      expect(result.sizeText).toBe('2.0 MB')
      expect(result.downloadUrl).toBe('https://hub.coigame.com/Mod/DownloadMod/99')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
