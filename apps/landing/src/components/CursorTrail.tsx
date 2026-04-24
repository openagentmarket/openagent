'use client'

import { useEffect } from 'react'

const CHARS = ['*', '>', '<', '.', ':', '[]', ',', '~', '|', '_', '#', ';', '$', '{', '}', '\\', '/']
const DURATION = 900

export function CursorTrail() {
  useEffect(() => {
    let lastX = 0
    let lastY = 0

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (Math.sqrt(dx * dx + dy * dy) < 15) return
      lastX = e.clientX
      lastY = e.clientY

      const char = CHARS[Math.floor(Math.random() * CHARS.length)]
      const drift = (Math.random() - 0.5) * 30
      const el = document.createElement('span')

      el.textContent = char
      el.style.position = 'fixed'
      el.style.left = e.clientX + 'px'
      el.style.top = e.clientY + 'px'
      el.style.pointerEvents = 'none'
      el.style.userSelect = 'none'
      el.style.fontSize = '11px'
      el.style.fontFamily = 'monospace'
      el.style.color = 'rgba(128,128,128,0.7)'
      el.style.zIndex = '99999'
      el.style.transform = 'translate(-50%, -50%)'

      document.body.appendChild(el)

      let start: number | null = null
      const animate = (ts: number) => {
        if (!start) start = ts
        const p = Math.min((ts - start) / DURATION, 1)
        el.style.opacity = String(0.7 * (1 - p))
        el.style.transform = `translate(calc(-50% + ${drift * p}px), calc(-50% - ${22 * p}px))`
        if (p < 1) requestAnimationFrame(animate)
        else el.remove()
      }
      requestAnimationFrame(animate)
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return null
}
