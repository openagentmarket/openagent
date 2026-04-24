import { readFileSync } from 'fs'
import { join } from 'path'
import type { Metadata } from 'next'

import { LegalPage } from '@/components/openagent/LegalPage'
import { OPENAGENT_OG_IMAGE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms and open-source usage notes for OpenAgent.',
  openGraph: {
    title: 'Terms — OpenAgent',
    description: 'Terms and open-source usage notes for OpenAgent.',
    images: [OPENAGENT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Terms — OpenAgent',
    description: 'Terms and open-source usage notes for OpenAgent.',
    images: [OPENAGENT_OG_IMAGE.url],
  },
}

export default function TermsPage() {
  const content = readFileSync(
    join(process.cwd(), 'src/content/openagent/terms.md'),
    'utf-8'
  )

  return <LegalPage content={content} />
}
