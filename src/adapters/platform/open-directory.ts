import { invoke } from '@tauri-apps/api/core'

export async function openDirectoryPath(dirPath: string): Promise<void> {
  try {
    await invoke('open_mod_directory', { path: dirPath })
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/tauri|ipc|invoke|__TAURI_INTERNALS__/i.test(message)) {
      throw error
    }
  }

  // Browser fallback: browsers block file:// URLs in window.open() for security.
  // Try to copy the path to clipboard so the user can paste it into Explorer.
  try {
    await navigator.clipboard.writeText(dirPath)
  } catch {
    throw new Error(
      `浏览器无法直接打开本地目录：${dirPath}。请手动在文件资源管理器中打开此路径。`
    )
  }

  throw new Error(
    `浏览器无法直接打开本地目录。路径已复制到剪贴板，请粘贴到文件资源管理器中打开：${dirPath}\n\n提示：请使用 'pnpm tauri:dev' 启动桌面应用以获得完整功能。`
  )
}
