/**
 * TauriApiService — Tauri 桌面模式 API 实现
 *
 * 通过 @tauri-apps/api/core invoke() 调用 Rust 端 Tauri Commands。
 * 仅在 Tauri 环境下实例化（由 api-service.ts 工厂检测 __TAURI_INTERNALS__）。
 *
 * 并发隔离：upgrade 事件按 installDir 过滤，避免多 mod 并发升级时事件串扰。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ChangelogEntry,
  IModApiService,
  ModRecord,
  ScanModsResponse,
  ScanEvent,
  UpgradeEvent,
  UpgradePhase,
} from '@/shared/types/api'

/** Timeout for upgrade operations — 5 minutes without events. */
const UPGRADE_EVENT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Raw event payload from Rust — includes installDir for per-mod filtering.
 */
interface RawUpgradeEvent {
  type: string
  installDir?: string
  progress?: { phase: string; message: string; percent?: number }
  result?: ScanModsResponse
  message?: string
}

export class TauriApiService implements IModApiService {
  /**
   * 快速本地扫描 — 调用 Rust `local_scan` 命令。
   * 扫描 %APPDATA%/Captain of Industry/Mods 目录。
   */
  async localScan(): Promise<ScanModsResponse> {
    return invoke<ScanModsResponse>('local_scan')
  }

  /**
   * 流式扫描 — 调用 Rust `stream_scan` 命令 + 监听 `scan-event` 全局事件。
   * Rust 端通过 app.emit() 推送 start / mod / complete 事件。
   */
  async streamScan(onEvent: (event: ScanEvent) => void): Promise<ScanModsResponse> {
    return new Promise<ScanModsResponse>((resolve, reject) => {
      let unlisten: UnlistenFn | null = null

      // Start listening to scan events before invoking the command
      listen<ScanEvent>('scan-event', (payload) => {
        const event = payload.payload
        onEvent(event)

        if (event.type === 'complete') {
          unlisten?.()
          resolve(event.result)
        }
        if (event.type === 'error') {
          unlisten?.()
          reject(new Error(event.message))
        }
      }).then((fn) => {
        unlisten = fn
        // Trigger the scan
        invoke('stream_scan').catch((err) => {
          unlisten?.()
          reject(err instanceof Error ? err : new Error(String(err)))
        })
      }).catch((err) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  /**
   * 检查单个 Mod — 调用 Rust `check_mod` 命令。
   * 读取 manifest.json，计算目录大小，返回 Mod 信息。
   */
  async checkMod(installDir: string): Promise<ModRecord> {
    return invoke<ModRecord>('check_mod', { installDir })
  }

  /**
   * 流式升级 — 调用 Rust `stream_upgrade` 命令 + 监听 `upgrade-event`。
   *
   * 并发安全：事件按 installDir 过滤，每个 mod 只接收自己的事件。
   * 超时保护：5 分钟无事件则 reject。
   */
  async streamUpgrade(
    installDir: string,
    downloadUrl: string,
    hubPageUrl: string | undefined,
    onEvent: (event: UpgradeEvent) => void
  ): Promise<ScanModsResponse> {
    return new Promise<ScanModsResponse>((resolve, reject) => {
      let unlisten: UnlistenFn | null = null
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null
      let settled = false

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        unlisten?.()
      }

      const resetTimeout = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        timeoutTimer = setTimeout(() => {
          if (!settled) {
            settled = true
            cleanup()
            reject(new Error(`Upgrade timed out after ${UPGRADE_EVENT_TIMEOUT_MS / 1000}s with no events: ${installDir}`))
          }
        }, UPGRADE_EVENT_TIMEOUT_MS)
      }

      resetTimeout()

      listen<RawUpgradeEvent>('upgrade-event', (payload) => {
        const raw = payload.payload

        // Filter by installDir — ignore events for other mods
        if (raw.installDir && raw.installDir !== installDir) {
          return
        }

        resetTimeout()

        if (raw.type === 'progress' && raw.progress) {
          const event: UpgradeEvent = {
            type: 'progress',
            progress: {
              phase: raw.progress.phase as UpgradePhase,
              message: raw.progress.message,
              percent: raw.progress.percent,
            },
          }
          onEvent(event)
        } else if (raw.type === 'complete' && raw.result) {
          if (!settled) {
            settled = true
            cleanup()
            const event: UpgradeEvent = { type: 'complete', result: raw.result }
            onEvent(event)
            resolve(raw.result)
          }
        } else if (raw.type === 'error') {
          if (!settled) {
            settled = true
            cleanup()
            const errMsg = raw.message ?? 'Unknown upgrade error'
            const event: UpgradeEvent = { type: 'error', message: errMsg }
            onEvent(event)
            reject(new Error(errMsg))
          }
        }
      }).then((fn) => {
        unlisten = fn
        invoke('stream_upgrade', { installDir, downloadUrl, hubPageUrl }).catch((err) => {
          if (!settled) {
            settled = true
            cleanup()
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      }).catch((err) => {
        if (!settled) {
          settled = true
          cleanup()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  async fetchChangelog(hubUrl: string): Promise<ChangelogEntry[]> {
    return invoke<ChangelogEntry[]>('fetch_changelog', { hubUrl })
  }
}
