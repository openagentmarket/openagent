// FILE: github.ts
// Purpose: Fetch public GitHub repository metadata used across the landing page.
// Layer: Server utility
// Exports: OPENAGENT_REPO_URL, getOpenAgentStars
// Depends on: GitHub REST API, optional GITHUB_TOKEN environment variable

const GITHUB_OWNER = 'openagentmarket'
const GITHUB_REPO = 'openagent'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

export const OPENAGENT_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

type GitHubRepositoryResponse = {
  stargazers_count?: number
}

export async function getOpenAgentStars(): Promise<number | null> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(GITHUB_API_URL, {
    headers,
    next: { revalidate: 60 },
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as GitHubRepositoryResponse
  return typeof data.stargazers_count === 'number' ? data.stargazers_count : null
}
