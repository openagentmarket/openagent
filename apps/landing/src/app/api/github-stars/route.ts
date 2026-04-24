// FILE: route.ts
// Purpose: Expose the OpenAgent star count to the frontend without calling GitHub from the browser.
// Layer: API route
// Exports: GET
// Depends on: NextResponse, getOpenAgentStars

import { NextResponse } from 'next/server'

import { OPENAGENT_REPO_URL, getOpenAgentStars } from '@/lib/github'

// ─── ENTRY POINT ─────────────────────────────────────────────

// Returns the latest cached star count for the public GitHub CTA.
export async function GET() {
  const stars = await getOpenAgentStars()

  return NextResponse.json({
    repoUrl: OPENAGENT_REPO_URL,
    stars,
  })
}
