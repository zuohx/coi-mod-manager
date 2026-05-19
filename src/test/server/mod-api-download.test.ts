import { describe, it, expect } from 'vitest'

describe('mod api download url extraction', () => {
  it('should prefer the latest download button from mod detail html', async () => {
    const modApi = await import('../../../server/mod-api.ts')

    const html = `
      <section>
        <a href="/Mod/DownloadMod/97">Download</a>
        <span>Latest</span>
      </section>
      <section>
        <span>v1.0.0</span>
        <a href="/Mod/DownloadMod/21">Download</a>
      </section>
      <section>
        <span>v0.2.2</span>
        <a href="/Mod/DownloadMod/22">Download</a>
      </section>
    `

    const result = (modApi as any).__test.extractDownloadUrlFromDetailHtml(html)

    expect(result).toBe('https://hub.coigame.com/Mod/DownloadMod/97')
  })

  it('should fallback to first download candidate when no latest marker exists', async () => {
    const modApi = await import('../../../server/mod-api.ts')

    const html = `
      <button data-url="/Mod/DownloadMod/123">Download</button>
      <button data-url="/Mod/DownloadMod/456">Download old</button>
    `

    const result = (modApi as any).__test.extractDownloadUrlFromDetailHtml(html)

    expect(result).toBe('https://hub.coigame.com/Mod/DownloadMod/123')
  })
})
