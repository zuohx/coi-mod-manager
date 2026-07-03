import { useCallback, useMemo, useRef, useState } from 'react'

export type LogType = 'info' | 'ok' | 'warn' | 'err' | 'dim'

export interface LogLine {
  id: number
  text: string
  type: LogType
}

export function useLogs() {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logVisible, setLogVisible] = useState(false)
  const [hoveredLogId, setHoveredLogId] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const tooltipShowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const appendLog = useCallback((text: string, type: LogType = 'info') => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, type }])
    setLogVisible(true)
  }, [])

  const logPanelProps = useMemo(
    () => ({
      logs,
      logVisible,
      hoveredLogId,
      tooltipPos,
      tooltipShowTimer,
      tooltipHideTimer,
      setHoveredLogId,
      setTooltipPos,
    }),
    [hoveredLogId, logVisible, logs, tooltipPos]
  )

  return {
    logs,
    logVisible,
    hoveredLogId,
    tooltipPos,
    tooltipShowTimer,
    tooltipHideTimer,
    appendLog,
    setLogVisible,
    setHoveredLogId,
    setTooltipPos,
    logPanelProps,
  }
}
