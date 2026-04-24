'use client'

import { useRef, useState, useCallback } from 'react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'

const SCREENS = [
  '/screens/rm-0.png',
  '/screens/rm-1.png',
  '/screens/rm-2.png',
  '/screens/rm-3.png',
  '/screens/rm-4.png',
  '/screens/rm-5.png',
  '/screens/rm-6.png',
  '/screens/rm-8.png',
]

export function AppPreview() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const scrollToIndex = useCallback((i: number) => {
    const container = scrollRef.current
    if (!container) return
    const cards = container.querySelectorAll<HTMLElement>('[data-screen]')
    const clamped = Math.max(0, Math.min(i, cards.length - 1))
    cards[clamped]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
    setIndex(clamped)
  }, [])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const cards = container.querySelectorAll<HTMLElement>('[data-screen]')
    let closest = 0
    let minDist = Infinity
    cards.forEach((card, i) => {
      const dist = Math.abs(card.offsetLeft - container.scrollLeft)
      if (dist < minDist) { minDist = dist; closest = i }
    })
    setIndex(closest)
  }, [])

  return (
    <div className="relative group/preview">
      {/* Navigation arrows */}
      <button
        onClick={() => scrollToIndex(index - 1)}
        className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur border border-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground hover:border-foreground/25 transition-all opacity-0 group-hover/preview:opacity-100 cursor-pointer"
        aria-label="Previous screenshot"
      >
        <LuChevronLeft size={20} />
      </button>
      <button
        onClick={() => scrollToIndex(index + 1)}
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur border border-foreground/10 flex items-center justify-center text-foreground/50 hover:text-foreground hover:border-foreground/25 transition-all opacity-0 group-hover/preview:opacity-100 cursor-pointer"
        aria-label="Next screenshot"
      >
        <LuChevronRight size={20} />
      </button>

      {/* Scrollable track */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {SCREENS.map((src, i) => (
          <div
            key={src}
            data-screen
            className="flex-shrink-0 snap-start w-[280px] md:w-[calc((100%-16px)/2)] lg:w-[calc((100%-48px)/4)]"
          >
            <div className="rounded-3xl border border-foreground/10 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`App preview ${i + 1}`}
                className="block w-full h-auto"
                loading={i < 4 ? 'eager' : 'lazy'}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 sm:w-32 z-10 bg-gradient-to-r from-background/70 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 sm:w-32 z-10 bg-gradient-to-l from-background/70 to-transparent" />
    </div>
  )
}
