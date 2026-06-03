/// <reference types="vite/client" />

/** Tauri 运行时注入的全局标记，用于检测 Tauri 桌面环境 */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }

  /** Vite define 注入的应用版本号（来自 package.json） */
  const __APP_VERSION__: string
}

export {}
