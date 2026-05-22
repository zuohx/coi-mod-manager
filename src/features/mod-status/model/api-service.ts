/**
 * API Service 工厂
 *
 * 根据运行环境自动选择实现：
 *   - Web 模式（浏览器）→ HttpApiService
 *   - Tauri 桌面模式       → TauriApiService
 */

import type { IModApiService } from '@/shared/types/api'
import { HttpApiService } from './api-service-http'
import { TauriApiService } from './api-service-tauri'

/**
 * 创建当前环境适用的 API 服务实例。
 *
 * 检测逻辑：Tauri 注入 `window.__TAURI_INTERNALS__`，
 * 存在则该环境支持 Tauri IPC，优先使用 Rust 原生实现。
 */
export function createApiService(): IModApiService {
  // Tauri 桌面模式 → Rust 原生命令
  if (window.__TAURI_INTERNALS__) {
    return new TauriApiService()
  }

  // Web 模式 → HTTP fetch to Node.js server
  return new HttpApiService()
}
