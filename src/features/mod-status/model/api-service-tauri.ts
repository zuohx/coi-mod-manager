/**
 * TauriApiService — Tauri 桌面模式 API 实现
 *
 * 通过 @tauri-apps/api/core invoke() 调用 Rust 端 Tauri Commands。
 * 仅在 Tauri 环境下实例化（由 api-service.ts 工厂检测 __TAURI_INTERNALS__）。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  IModApiService,
  ModRecord,
  ScanModsResponse,
  ScanEvent,
  UpgradeEvent,
} from '@/shared/types/api'

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
   * Rust 端通过 app.emit("upgrade-event") 推送进度事件。
   */
  async streamUpgrade(
    installDir: string,
    downloadUrl: string,
    hubPageUrl: string | undefined,
    onEvent: (event: UpgradeEvent) => void
  ): Promise<ScanModsResponse> {
    return new Promise<ScanModsResponse>((resolve, reject) => {
      let unlisten: UnlistenFn | null = null

      listen<UpgradeEvent>('upgrade-event', (payload) => {
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
        invoke('stream_upgrade', { installDir, downloadUrl, hubPageUrl }).catch((err) => {
          unlisten?.()
          reject(err instanceof Error ? err : new Error(String(err)))
        })
      }).catch((err) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }
}
