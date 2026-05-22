import type { UpdateStatus } from '../model/use-app-update'
import './UpdateToast.css'

export interface UpdateToastProps {
  visible: boolean
  status: UpdateStatus
  latestVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  onInstall: () => void
  onDismiss: () => void
}

export function UpdateToast({
  visible,
  status,
  latestVersion,
  downloadProgress,
  errorMessage,
  onInstall,
  onDismiss,
}: UpdateToastProps) {
  if (!visible) return null

  const showProgress = status === 'downloading' || status === 'installing'
  const isError = status === 'error'
  const showActions = status === 'available'

  return (
    <div className={`update-toast${isError ? ' update-toast--error' : ''}`}>
      <div className="update-toast__body">
        <div className="update-toast__content">
          {status === 'available' && (
            <>
              <div className="update-toast__title">发现新版本</div>
              <div className="update-toast__message">
                新版本 <strong>v{latestVersion}</strong> 可用，是否立即更新？
              </div>
            </>
          )}
          {isError && (
            <>
              <div className="update-toast__title">检查更新失败</div>
              <div className="update-toast__message">{errorMessage}</div>
            </>
          )}
          {showProgress && (
            <>
              <div className="update-toast__title">
                {status === 'downloading' ? '正在下载更新...' : '正在安装更新...'}
              </div>
              <div className="update-toast__progress-track">
                <div
                  className="update-toast__progress-fill"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <div className="update-toast__progress-text">{downloadProgress}%</div>
            </>
          )}
        </div>
      </div>
      {showActions && (
        <div className="update-toast__actions">
          <button type="button" className="btn update-toast__btn update-toast__btn--primary" onClick={onInstall}>
            立即更新
          </button>
          <button type="button" className="btn update-toast__btn update-toast__btn--default" onClick={onDismiss}>
            稍后更新
          </button>
        </div>
      )}
      {(isError || showProgress) && (
        <div className="update-toast__actions">
          <button
            type="button"
            className="btn update-toast__btn update-toast__btn--text"
            onClick={onDismiss}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
