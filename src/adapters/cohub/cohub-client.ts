import type { HubCandidate } from '@/domain/mod/types'
import type { Result } from '@/shared/lib/result'
import { ok, err } from '@/shared/lib/result'

export async function searchCoiHub(query: string): Promise<Result<HubCandidate[], Error>> {
  try {
    // 注意：COI Hub 暂无官方 API，此处为模拟实现
    // 实际使用时应抓取网页或寻找非官方接口
    const response = await fetch(`https://hub.coigame.com/api/mods?search=${encodeURIComponent(query)}`)
    const data = await response.json()

    const candidates: HubCandidate[] = data.results.map((item: any) => ({
      remoteId: String(item.id),
      title: item.title,
      version: item.version,
      exact: item.title.toLowerCase() === query.toLowerCase(),
      score: item.title.toLowerCase() === query.toLowerCase() ? 1.0 : 0.8
    }))

    return ok(candidates)
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
