import type { RefObject } from 'react'

import type { LogLine } from '@/features/mod-status/model/use-logs'

export function LogPanel({
  logs,
  logVisible,
  hoveredLogId,
  tooltipPos,
  tooltipShowTimerRef,
  tooltipHideTimerRef,
  setHoveredLogId,
  setTooltipPos,
}: {
  logs: LogLine[]
  logVisible: boolean
  hoveredLogId: number | null
  tooltipPos: { x: number; y: number }
  tooltipShowTimerRef: RefObject<ReturnType<typeof setTimeout> | null>
  tooltipHideTimerRef: RefObject<ReturnType<typeof setTimeout> | null>
  setHoveredLogId: (v: number | null) => void
  setTooltipPos: (v: { x: number; y: number }) => void
}) {
  return (
    <section className={`log-panel card${logVisible ? ' visible' : ''}`}>
      <div className='log-header'>
        <span className='log-title'>操作日志</span>
      </div>
      {logVisible && (
        <div className='log-body'>
          {logs.length === 0 ? (
            <div className='log-line dim'>暂无日志</div>
          ) : (
            [...logs].reverse().map((line) => (
              <div
                key={line.id}
                className={`log-line ${line.type}`}
                onMouseEnter={(e) => {
                  if (tooltipHideTimerRef.current) clearTimeout(tooltipHideTimerRef.current)
                  if (tooltipShowTimerRef.current) clearTimeout(tooltipShowTimerRef.current)
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const pos = { x: rect.left + rect.width / 2, y: rect.top - 8 }
                  tooltipShowTimerRef.current = setTimeout(() => {
                    setHoveredLogId(line.id)
                    setTooltipPos(pos)
                  }, 300)
                }}
                onMouseLeave={() => {
                  if (tooltipShowTimerRef.current) clearTimeout(tooltipShowTimerRef.current)
                  tooltipHideTimerRef.current = setTimeout(() => setHoveredLogId(null), 500)
                }}
              >
                {line.text}
              </div>
            ))
          )}
        </div>
      )}
      {hoveredLogId !== null && (
        <div
          className='log-tooltip'
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={() => {
            if (tooltipHideTimerRef.current) clearTimeout(tooltipHideTimerRef.current)
          }}
          onMouseLeave={() => {
            tooltipHideTimerRef.current = setTimeout(() => setHoveredLogId(null), 500)
          }}
        >
          {logs.find((l) => l.id === hoveredLogId)?.text}
        </div>
      )}
    </section>
  )
}
