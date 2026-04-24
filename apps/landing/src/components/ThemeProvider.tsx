'use client'

/* FILE: ThemeProvider.tsx
   Purpose: Keep the site theme in sync with the operating system while exposing the current theme to client components.
   Layer: Client provider
   Depends on: document.documentElement for the Tailwind dark class and React context consumers such as ThemeToggle */

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const getSystemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  // Keep the in-app theme aligned with system changes and reset to system on refresh.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
    }
    const syncWithSystem = () => setTheme(mediaQuery.matches ? 'dark' : 'light')

    syncWithSystem()

    if ('addEventListener' in mediaQuery) {
      mediaQuery.addEventListener('change', syncWithSystem)

      return () => {
        mediaQuery.removeEventListener('change', syncWithSystem)
      }
    }

    legacyMediaQuery.addListener?.(syncWithSystem)

    return () => {
      legacyMediaQuery.removeListener?.(syncWithSystem)
    }
  }, [])

  // Mirror the resolved theme onto the root element so Tailwind dark styles stay in sync.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
