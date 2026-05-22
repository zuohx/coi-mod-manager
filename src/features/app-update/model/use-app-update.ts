import { useState, useCallback, useEffect, useRef } from 'react'
import { check } from '@tauri-apps/plugin-updater'

/**
 * 更新状态枚举
 */
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'no-update' | 'error'

/**
 * 应用在线更新 Hook
 *
 * - 提供自动检查（组件挂载后 delayMs 毫秒静默检查）
 * - 提供手动检查方法
 * - 管理更新状态与下载进度
 * - 对非 Tauri 环境做兼容处理
 */
export function useAppUpdate(options?: { autoCheck?: boolean; delayMs?: number }) {
  const { autoCheck = true, delayMs = 3000 } = options ?? {}

  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastDismissedRef = useRef(false)

  // 判断是否在 Tauri 环境中运行
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  /**
   * 检查更新
   */
  const doCheck = useCallback(async () => {
    if (!isTauri) {
      setStatus('no-update')
      return
    }

    setStatus('checking')
    setErrorMessage(null)

    try {
      const update = await check()
      if (update) {
        setStatus('available')
        setLatestVersion(update.version)
        toastDismissedRef.current = false
      } else {
        setStatus('no-update')
        setLatestVersion(null)
      }
    } catch (e) {
      setStatus('error')
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
  }, [isTauri])

  /**
   * 下载并安装更新
   */
  const doInstall = useCallback(async () => {
    if (!isTauri) return

    setStatus('downloading')
    setDownloadProgress(0)

    try {
      const update = await check()
      if (!update) {
        setStatus('no-update')
        return
      }

      let downloaded = 0
      let contentLength = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0
            setDownloadProgress(0)
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100))
            }
            break
          case 'Finished':
            setDownloadProgress(100)
            break
        }
      })

      setStatus('installing')
      // NSIS 安装器在 downloadAndInstall 完成后自动接管：
      // 退出当前应用 → 运行安装器 → 替换文件 → 启动新版本
    } catch (e) {
      setStatus('error')
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
  }, [isTauri])

  /**
   * 关闭 toast（用户手动关闭）
   */
  const dismiss = useCallback(() => {
    toastDismissedRef.current = true
    setStatus('idle')
  }, [])

  // 自动检查
  useEffect(() => {
    if (!autoCheck || !isTauri) return

    timerRef.current = setTimeout(() => {
      void doCheck()
    }, delayMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [autoCheck, delayMs, doCheck, isTauri])

  return {
    status,
    latestVersion,
    downloadProgress,
    errorMessage,
    /** 用户是否已手动关闭 toast */
    dismissed: toastDismissedRef.current,
    check: doCheck,
    install: doInstall,
    dismiss,
  }
}

export type UseAppUpdateReturn = ReturnType<typeof useAppUpdate>
