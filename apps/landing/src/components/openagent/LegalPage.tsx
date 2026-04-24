/* eslint-disable @next/next/no-img-element */
import { JetBrains_Mono } from 'next/font/google'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'

import { ThemeToggle } from '@/components/ThemeToggle'
import { OPENAGENT_REPO_URL } from '@/lib/github'

const mono = JetBrains_Mono({ subsets: ['latin'] })

export function LegalPage({ content }: { content: string }) {
  return (
    <div className="relative min-h-screen bg-background">
      <header className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-7 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img src="/icon.png" alt="OpenAgent" width={20} height={20} className="rounded-sm" />
          <span className="text-xs font-medium uppercase tracking-[0.28em] text-foreground/80">OpenAgent</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-12 md:py-20">
        <div className="w-full max-w-3xl mx-auto">
          <article className="legal-prose text-foreground/70 text-[15px] leading-7">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        </div>
      </main>

      <footer className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-8 border-t border-foreground/8">
        <div className="w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground/30">
          <div className="flex items-center gap-2">
            <img src="/icon.png" alt="OpenAgent" width={14} height={14} className="rounded-sm opacity-40" />
            <span className="text-foreground/40">OpenAgent</span>
          </div>
          <div className="flex items-center gap-5">
            <a href={OPENAGENT_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <Link href="/privacy-policy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <span className={mono.className}>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
