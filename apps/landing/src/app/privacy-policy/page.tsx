import { readFileSync } from 'fs'
import { join } from 'path'
import type { Metadata } from 'next'

import { LegalPage } from '@/components/openagent/LegalPage'
import { OPENAGENT_OG_IMAGE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Privacy Notice',
  description: 'Privacy notes for the OpenAgent website and the local-first OpenAgent workflow.',
  openGraph: {
    title: 'Privacy Notice — OpenAgent',
    description: 'Privacy notes for the OpenAgent website and the local-first OpenAgent workflow.',
    images: [OPENAGENT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Privacy Notice — OpenAgent',
    description: 'Privacy notes for the OpenAgent website and the local-first OpenAgent workflow.',
    images: [OPENAGENT_OG_IMAGE.url],
  },
}

export default function PrivacyPolicyPage() {
  const content = readFileSync(
    join(process.cwd(), 'src/content/openagent/privacy-policy.md'),
    'utf-8'
  )

  return <LegalPage content={content} />
}
