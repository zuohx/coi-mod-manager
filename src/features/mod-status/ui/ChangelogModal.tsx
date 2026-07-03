import { useEffect } from 'react'

import type { ChangelogEntry, ModRecord } from '@/shared/types/api'

export function ChangelogModal({
  mod,
  entries,
  loading,
  error,
  onClose,
}: {
  mod: ModRecord | null
  entries: ChangelogEntry[]
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!mod) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [mod, onClose])

  if (!mod) return null

  return (
    <div className='ant-modal-wrap' onClick={onClose}>
      <div
        className='ant-modal'
        onClick={(e) => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-label={`${mod.displayName} 更新日志`}
      >
        <div className='ant-modal-header'>
          <div className='ant-modal-title'>
            {mod.displayName}
            <span className='ant-modal-subtitle'>更新日志</span>
          </div>
          <button type='button' className='ant-modal-close' onClick={onClose} aria-label='关闭'>
            <svg viewBox='0 0 12 12' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M1 1l10 10M11 1L1 11' />
            </svg>
          </button>
        </div>
        <div className='ant-modal-body'>
          {loading && (
            <div className='changelog-loading'>
              <span className='size-spinner' />
              <span>加载中…</span>
            </div>
          )}
          {error && (
            <div className='changelog-error'>
              <span className='changelog-error-icon'>!</span>
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && entries.length === 0 && <div className='changelog-empty'>暂无更新日志</div>}
          {!loading && !error && entries.length > 0 && (
            <div className='changelog-list'>
              {entries.map((entry, i) => (
                <div key={i} className='changelog-entry'>
                  <div className='changelog-entry-header'>
                    <span className='changelog-entry-version'>{entry.version}</span>
                    {entry.date && <span className='changelog-entry-date'>{entry.date}</span>}
                  </div>
                  <pre className='changelog-entry-content'>{entry.content}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
