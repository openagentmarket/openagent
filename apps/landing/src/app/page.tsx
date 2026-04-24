/* eslint-disable @next/next/no-img-element */
import {
  Cormorant_Garamond,
  JetBrains_Mono,
  Libre_Baskerville,
} from 'next/font/google'
import { FaGithub, FaStar } from 'react-icons/fa6'
import {
  LuArrowRight,
  LuBoxes,
  LuFileText,
  LuGitBranch,
  LuMonitor,
  LuQrCode,
  LuSparkles,
  LuWorkflow,
} from 'react-icons/lu'

import { ThemeToggle } from '@/components/ThemeToggle'
import { TerminalGrid } from '@/components/TerminalGrid'
import { FadeIn } from '@/components/openagent/FadeIn'
import { CopyButton } from '@/components/openagent/CopyButton'
import { OPENAGENT_REPO_URL } from '@/lib/github'
import { OPENAGENT_STARS } from '@/lib/github-stars'

const displayFont = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})
const mono = JetBrains_Mono({ subsets: ['latin'] })
const headerBrandFont = Libre_Baskerville({
  subsets: ['latin'],
  weight: ['400', '700'],
})

const DOCS_URL = 'https://openagent-market-docs.web.app'
const BOOTSTRAP_SKILL_URL =
  'https://github.com/openagentmarket/openagent/tree/main/skills/openagent-canvas-bootstrap'
const BOOTSTRAP_PROMPT =
  'Use the openagent-canvas-bootstrap skill to set up OpenAgent for this repo.'

const FEATURES = [
  {
    icon: LuBoxes,
    title: 'Canvas-Native Tasks',
    description:
      'Select one or more nodes on a canvas and turn that selection directly into a Codex task.',
  },
  {
    icon: LuFileText,
    title: 'Nearby Markdown Context',
    description:
      'OpenAgent sends the selected nodes and nearby markdown context so the run stays grounded in your workspace.',
  },
  {
    icon: LuWorkflow,
    title: 'Write Back Into The Graph',
    description:
      'Results come back into Canvas so the graph stays the working surface instead of becoming a dead snapshot.',
  },
  {
    icon: LuMonitor,
    title: 'Local-First Runtime',
    description:
      'The repo stays on your machine, the daemon stays local, and Codex works against the real files on disk.',
  },
  {
    icon: LuQrCode,
    title: 'Mobile Control With Convos',
    description:
      'Use the local dashboard to create a thread, scan the QR, and keep chatting from your phone while your Mac runs the work.',
  },
  {
    icon: LuGitBranch,
    title: 'Repo-Aware Workflow',
    description:
      'OpenAgent is built for people who already think in repos, docs, and graph context, not generic chat surfaces.',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Install the bootstrap skill',
    description:
      'Add the OpenAgent bootstrap skill to Codex so setup can happen from a single prompt.',
    code: BOOTSTRAP_SKILL_URL,
  },
  {
    num: '02',
    title: 'Open your repo and vault',
    description:
      'Restart Codex, open the repo you want to use, and make sure your Obsidian vault is already open.',
    code: '',
  },
  {
    num: '03',
    title: 'Run the setup prompt',
    description:
      'Ask Codex to bootstrap OpenAgent for the current repo and it will wire the vault, plugin, runtime, and workspace canvas.',
    code: BOOTSTRAP_PROMPT,
  },
]

const GALLERY = [
  {
    title: 'Canvas selection to task',
    description:
      'OpenAgent starts from the graph you already built instead of forcing you to rewrite context into a prompt.',
  },
  {
    title: 'Live progress in context',
    description:
      'Runs stay attached to the local repo and the active workspace so you can follow what is happening without losing orientation.',
  },
  {
    title: 'Mobile bridge when you need it',
    description:
      'Convos becomes the remote chat surface while the real coding work still happens locally on your machine.',
  },
  {
    title: 'Result written back',
    description:
      'The output returns to Canvas so the graph keeps its memory and the next step starts from the right place.',
  },
]

export default function OpenAgentPage() {
  const stars = OPENAGENT_STARS

  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-[family-name:var(--font-sans)]">
      <TerminalGrid />

      <header className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-6">
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 text-foreground/85">
            <img
              src="/logo.png"
              alt="OpenAgent"
              width={34}
              height={34}
              className="h-8 w-8 object-contain dark:invert sm:h-9 sm:w-9"
            />
            <span className={`${headerBrandFont.className} text-[1rem] font-normal tracking-[-0.015em] sm:text-[1.08rem]`}>
              openagent
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-12 md:py-0 md:min-h-[calc(100vh-80px)] flex items-center">
        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-10 md:gap-16">
          <div className="flex flex-col items-start flex-1 w-full md:max-w-xl">
            <FadeIn delay={60}>
              <div className="flex flex-wrap items-center gap-2 mb-8">
                <a
                  href={OPENAGENT_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-foreground/15 bg-muted rounded-full px-3 py-1.5 transition-colors hover:border-foreground/25"
                >
                  <FaGithub size={11} className="text-foreground/50" />
                  <span className={`${mono.className} text-[10px] tracking-[0.22em] uppercase text-foreground/50`}>
                    Open source on GitHub
                  </span>
                  {typeof stars === 'number' && (
                    <span className="inline-flex items-center gap-1 text-foreground/40">
                      <FaStar size={8} />
                      <span className={`${mono.className} text-[10px]`}>{stars}</span>
                    </span>
                  )}
                </a>
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-foreground/15 bg-muted rounded-full px-3 py-1.5 transition-colors hover:border-foreground/25"
                >
                  <LuFileText size={11} className="text-foreground/50" />
                  <span className={`${mono.className} text-[10px] tracking-[0.22em] uppercase text-foreground/50`}>
                    Docs and install guides
                  </span>
                </a>
              </div>
            </FadeIn>

            <FadeIn delay={120}>
              <h1 className={`${displayFont.className} text-[2.6rem] sm:text-[3.4rem] md:text-[4.4rem] lg:text-[5.2rem] leading-[0.88] tracking-[-0.04em] text-foreground`}>
                From thought to action.
              </h1>
            </FadeIn>

            <FadeIn delay={180}>
              <p className="mt-8 text-[15px] sm:text-base leading-7 text-foreground/50 max-w-lg font-[family-name:var(--font-geist-sans)]">
                Select nodes on a canvas, create a task, keep nearby markdown context visible,
                and write the result back into the graph. OpenAgent is local-first,
                repo-aware, and built for the way you already work.
              </p>
            </FadeIn>

            <FadeIn delay={260} className="w-full">
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap w-full">
                <a
                  href={DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-foreground px-7 text-sm font-medium text-background font-sans transition-opacity hover:opacity-85"
                >
                  Read the Docs
                  <LuArrowRight size={16} />
                </a>
                <a
                  href={OPENAGENT_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${mono.className} inline-flex h-12 w-full sm:w-auto items-center justify-center gap-3 rounded-full border border-foreground/15 bg-muted px-4 sm:px-5 text-xs sm:text-sm text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground/80`}
                >
                  <FaGithub size={15} />
                  <span className="truncate">View on GitHub</span>
                </a>
              </div>
            </FadeIn>
          </div>

          <FadeIn delay={220} className="flex-shrink-0 w-full md:max-w-[42rem]">
            <img
              src="/openagent-canvas-screenshot.png"
              alt="OpenAgent running inside Obsidian Canvas with a live Codex thread beside the graph"
              className="w-full h-auto object-cover"
            />
          </FadeIn>
        </div>
      </section>

      <section className="relative z-20 py-24 md:py-36">
        <div className="w-full max-w-7xl mx-auto px-5 sm:px-6 md:px-16 lg:px-24 mb-14">
          <FadeIn>
            <span className={`${mono.className} text-[11px] tracking-[0.3em] uppercase text-foreground/30`}>
              Workflow
            </span>
            <h2 className={`${displayFont.className} mt-4 text-3xl sm:text-4xl md:text-5xl leading-[0.92] tracking-[-0.035em] text-foreground`}>
              See it in context.
            </h2>
          </FadeIn>
        </div>
        <div className="w-full max-w-7xl mx-auto px-5 sm:px-6 md:px-16 lg:px-24">
          <FadeIn delay={100}>
            <img
              src="/openagent-canvas-screenshot.png"
              alt="OpenAgent workspace preview"
              className="w-full h-auto"
            />
          </FadeIn>
        </div>
      </section>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-24 md:py-36">
        <div className="w-full max-w-7xl mx-auto">
          <FadeIn>
            <span className={`${mono.className} text-[11px] tracking-[0.3em] uppercase text-foreground/30`}>
              Interface
            </span>
            <h2 className={`${displayFont.className} mt-4 text-3xl sm:text-4xl md:text-5xl leading-[0.92] tracking-[-0.035em] text-foreground`}>
              Built around the graph.
            </h2>
          </FadeIn>

          <div className="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {GALLERY.map((item, i) => (
              <FadeIn key={item.title} delay={i * 80}>
                <div className="group rounded-[2rem] border-2 border-foreground/15 bg-card overflow-hidden h-full flex flex-col">
                  <div className="relative w-full overflow-hidden aspect-[2/1]">
                    <img
                      src="/openagent-canvas-screenshot.png"
                      alt={item.title}
                      className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-card to-transparent" />
                  </div>
                  <div className="px-5 sm:px-7 md:px-8 py-4 sm:py-5">
                    <h3 className="text-sm sm:text-base font-medium text-foreground mb-1 font-sans">{item.title}</h3>
                    <p className="text-xs sm:text-sm leading-relaxed text-foreground/45 font-[family-name:var(--font-geist-sans)]">{item.description}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-24 md:py-36">
        <div className="w-full max-w-7xl mx-auto">
          <FadeIn>
            <span className={`${mono.className} text-[11px] tracking-[0.3em] uppercase text-foreground/30`}>
              Features
            </span>
            <h2 className={`${displayFont.className} mt-4 text-3xl sm:text-4xl md:text-5xl leading-[0.92] tracking-[-0.035em] text-foreground`}>
              Everything you need.
              {' '}
              <span className="text-foreground/20">Nothing off-context.</span>
            </h2>
          </FadeIn>

          <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
            {FEATURES.map((f, i) => (
              <FadeIn key={f.title} delay={i * 60}>
                <div className="rounded-2xl border border-foreground/10 bg-card p-6 sm:p-7 md:p-8 h-full">
                  <f.icon size={22} strokeWidth={1.5} className="text-foreground/35 mb-5" />
                  <h3 className="text-base font-medium text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-foreground/40">{f.description}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-24 md:py-36">
        <div className="w-full max-w-7xl mx-auto">
          <FadeIn>
            <span className={`${mono.className} text-[11px] tracking-[0.3em] uppercase text-foreground/30`}>
              Setup
            </span>
            <h2 className={`${displayFont.className} mt-4 text-3xl sm:text-4xl md:text-5xl leading-[0.92] tracking-[-0.035em] text-foreground`}>
              Three moves, then you&apos;re in.
            </h2>
          </FadeIn>

          <div className="mt-16 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
            {STEPS.map((s, i) => (
              <FadeIn key={s.num} delay={i * 100}>
                <div className="rounded-2xl border border-foreground/10 bg-card p-6 sm:p-7 md:p-8 h-full flex flex-col">
                  <span className={`${mono.className} text-[11px] tracking-[0.3em] text-foreground/20`}>{s.num}</span>
                  <h3 className="mt-4 text-base font-medium text-foreground mb-2">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-foreground/40 mb-5 flex-1">{s.description}</p>
                  {s.code ? (
                    <div className={`${mono.className} text-[11px] sm:text-xs text-foreground/50 bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 flex items-center justify-between gap-2 sm:gap-3`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-foreground/20 shrink-0">$</span>
                        <span className="truncate">{s.code}</span>
                      </span>
                      <CopyButton text={s.code} />
                    </div>
                  ) : (
                    <div className="h-10" />
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-24 md:py-36">
        <div className="w-full max-w-7xl mx-auto">
          <FadeIn>
            <div className="rounded-2xl border border-foreground/10 bg-card p-6 sm:p-8 md:p-16">
              <div className="flex flex-col md:flex-row gap-6 sm:gap-10 md:gap-16">
                <LuSparkles size={32} strokeWidth={1.3} className="text-foreground/25 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className={`${displayFont.className} text-2xl sm:text-3xl md:text-4xl leading-[0.92] tracking-[-0.03em] text-foreground mb-5`}>
                    Local-first by design
                  </h3>
                  <p className="text-[15px] leading-7 text-foreground/40 max-w-2xl">
                    OpenAgent keeps the repo on your machine, the daemon on your machine,
                    and the Codex runtime attached to the real workspace on disk. Convos
                    can act as the mobile chat surface, but the work still happens locally.
                  </p>
                  <div className={`${mono.className} mt-10 flex flex-wrap gap-2`}>
                    {['Obsidian Canvas', 'Local daemon', 'Codex runtime', 'Convos bridge', 'Graph context'].map(t => (
                      <span key={t} className="rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1 text-[10px] tracking-[0.15em] uppercase text-foreground/35">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-24 md:py-44">
        <div className="w-full max-w-7xl mx-auto text-center">
          <FadeIn>
            <span className={`${mono.className} text-[11px] tracking-[0.3em] uppercase text-foreground/30`}>
              Get Started
            </span>
            <h2 className={`${displayFont.className} mt-5 text-3xl sm:text-4xl md:text-6xl leading-[0.88] tracking-[-0.04em] text-foreground`}>
              The graph holds context.
              <br />
              <span className="shimmer-text">Codex keeps moving.</span>
            </h2>
            <p className="mt-6 text-sm sm:text-base text-foreground/40 max-w-md mx-auto leading-relaxed font-[family-name:var(--font-geist-sans)]">
              Open source. Local-first. Built for repos, notes, and canvas context.
              Start with the docs, then bootstrap it into your current workflow.
            </p>
          </FadeIn>

          <FadeIn delay={120}>
            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-8 text-sm font-medium text-background font-sans transition-opacity hover:opacity-85"
              >
                Read the Docs
              </a>
              <a
                href={OPENAGENT_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-foreground/15 px-7 text-sm font-medium text-foreground/50 transition-colors hover:text-foreground hover:border-foreground/30 font-sans"
              >
                <FaGithub size={15} />
                View on GitHub
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      <footer className="relative z-20 px-5 sm:px-6 md:px-16 lg:px-24 py-8 border-t border-foreground/8">
        <div className="w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground/30">
          <div className="flex items-center gap-2">
            <img src="/icon.png" alt="OpenAgent" width={14} height={14} className="rounded-sm opacity-40" />
            <span className="text-foreground/40">OpenAgent</span>
          </div>
          <div className="flex items-center gap-5">
            <a href={OPENAGENT_REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground/50 transition-colors">GitHub</a>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground/50 transition-colors">Docs</a>
            <a href="/privacy-policy" className="hover:text-foreground/50 transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-foreground/50 transition-colors">Terms</a>
            <span className={mono.className}>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
