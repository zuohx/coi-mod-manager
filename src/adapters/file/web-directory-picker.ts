import type { Result } from '@/shared/lib/result'
import { ok, err } from '@/shared/lib/result'

interface DirectoryPicker {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>
}

export async function pickDirectory(): Promise<Result<FileSystemDirectoryHandle, Error>> {
  // 检查浏览器是否支持 File System Access API
  const win = window as unknown as DirectoryPicker
  if (typeof win.showDirectoryPicker !== 'function') {
    return err(new Error('File System Access API is not supported in this browser'))
  }

  try {
    const handle = await win.showDirectoryPicker()
    return ok(handle)
  } catch (e) {
    // 用户取消或发生错误
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}
