'use client'

/* FILE: ThemeToggle.tsx
   Purpose: Render a lightweight theme switch that reflects the currently resolved site theme.
   Layer: Client UI component
   Depends on: ThemeProvider for the active theme and toggle handler */

import { useEffect, useState } from 'react'
import { IconSun, IconMoon } from '@tabler/icons-react'
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <button
      onClick={toggle}
      className="text-foreground/50 hover:text-foreground transition-colors cursor-pointer"
      aria-label="Toggle theme"
    >
      {mounted ? (theme === 'dark' ? <IconSun size={16} stroke={1.8} /> : <IconMoon size={16} stroke={1.8} />) : null}
    </button>
  )
}
