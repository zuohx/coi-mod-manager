import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('coi-mod-manager-theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  const toggleTheme = useCallback(() => {
    const apply = () => {
      setTheme((prev) => {
        const next = prev === 'light' ? 'dark' : 'light'
        try {
          localStorage.setItem('coi-mod-manager-theme', next)
        } catch {}
        return next
      })
    }

    if ('startViewTransition' in document) {
      ;(document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() => apply())
    } else {
      apply()
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return { theme, toggleTheme }
}

export { getInitialTheme }
