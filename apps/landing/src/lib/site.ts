// FILE: site.ts
// Purpose: Centralize shared site metadata values reused across route segments.
// Layer: App metadata utility
// Exports: SITE_URL, OPENAGENT_OG_IMAGE
// Depends on: Next.js metadata consumers in src/app

export const SITE_URL = 'https://openagent-market-docs.web.app'

export const OPENAGENT_OG_IMAGE = {
  url: `${SITE_URL}/openagent-canvas-screenshot.png`,
  width: 3680,
  height: 2392,
  alt: 'OpenAgent — Obsidian Canvas workspace for Codex',
}
