import { useEffect, useRef, useState } from 'react'

import { FILTER_OPTIONS } from '@/features/mod-status/model/mod-status-view'
import type { StatusFilter } from '@/features/mod-status/model/mod-status-view'

export function FilterSelect({
  value,
  onChange,
}: {
  value: StatusFilter
  onChange: (v: StatusFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedLabel = FILTER_OPTIONS.find((o) => o.value === value)?.label ?? '全部'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div className='ant-select' ref={containerRef}>
      <div
        className={`ant-select-selector${open ? ' ant-select-selector-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        role='combobox'
        aria-expanded={open}
        aria-haspopup='listbox'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
      >
        <span className='ant-select-selection-item'>{selectedLabel}</span>
        <span className={`ant-select-arrow${open ? ' ant-select-arrow-open' : ''}`}>
          <svg viewBox='0 0 12 12' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M2 4.5l4 3 4-3' />
          </svg>
        </span>
      </div>
      {open && (
        <div className='ant-select-dropdown'>
          <div className='ant-select-item-option-group' role='listbox'>
            {FILTER_OPTIONS.map((opt) => {
              const selected = opt.value === value
              return (
                <div
                  key={opt.value}
                  className={`ant-select-item-option${selected ? ' ant-select-item-option-selected' : ''}`}
                  role='option'
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                >
                  <span className='ant-select-item-option-content'>{opt.label}</span>
                  {selected && (
                    <span className='ant-select-item-option-state'>
                      <svg viewBox='0 0 12 12' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                        <path d='M2.5 6l2.5 2.5 4.5-5' />
                      </svg>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
