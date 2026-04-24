'use client'

import { useState } from 'react'
import { LuCopy, LuCheck } from 'react-icons/lu'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-foreground/40 hover:text-foreground/70 transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <LuCheck size={14} /> : <LuCopy size={14} />}
    </button>
  )
}
