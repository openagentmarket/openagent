import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function DocLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label?: string;
  className?: string;
  children?: ReactNode;
}): ReactNode {
  const content = children ?? label;

  if (href.startsWith('http')) {
    return (
      <Link className={className} href={href}>
        {content}
      </Link>
    );
  }

  return (
    <Link className={className} to={href}>
      {content}
    </Link>
  );
}

const paths = [
  {
    title: 'Evaluate OpenAgent',
    description: 'Understand product fit, constraints, and who OpenAgent is actually for.',
    links: [
      {label: 'Start here', href: '/docs/evaluate-openagent'},
      {label: 'README overview', href: 'https://github.com/openagentmarket/openagent'},
    ],
  },
  {
    title: 'Install OpenAgent',
    description: 'Choose between the recommended bootstrap flow and the manual plugin install path.',
    links: [
      {label: 'Install guide', href: '/docs/install-openagent'},
      {label: 'Manual install', href: '/docs/getting-started/manual-install'},
    ],
  },
  {
    title: 'Use In Obsidian',
    description: 'Follow the main workflow for workspaces, selections, result nodes, and follow-ups.',
    links: [
      {label: 'Obsidian path', href: '/docs/use-openagent-in-obsidian'},
      {label: 'User guide', href: '/docs/getting-started/user-guide'},
      {label: 'Group context', href: '/docs/concepts/group-context'},
    ],
  },
  {
    title: 'Use From Mobile',
    description: 'Run the Convos flow when your phone is the chat surface but your Mac stays the runtime.',
    links: [
      {label: 'Mobile guide', href: '/docs/getting-started/mobile-guide'},
    ],
  },
  {
    title: 'Contribute',
    description: 'Get repo context, architecture, plugin workflow, and release docs for contributor work.',
    links: [
      {label: 'Contributor path', href: '/docs/contribute-to-openagent'},
      {label: 'Project map', href: '/docs/concepts/project-map'},
      {label: 'Architecture', href: '/docs/engineering/architecture'},
    ],
  },
];

const references = [
  {
    title: 'Core References',
    description: 'Deeper docs for mental models, architecture, and implementation details.',
    links: [
      {label: 'Canvas reference', href: '/docs/concepts/obsidian-canvas'},
      {label: 'Project map', href: '/docs/concepts/project-map'},
      {label: 'Task stream flow', href: '/docs/engineering/task-stream-flow'},
    ],
  },
  {
    title: 'Working Notes',
    description: 'Research and design notes that support ongoing product and engineering work.',
    links: [
      {label: 'Safe skill sandbox MVP', href: '/docs/notes/safe-skill-sandbox-mvp'},
      {label: 'Canvas image support', href: '/docs/notes/canvas-image-support'},
    ],
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const wordmarkUrl = useBaseUrl('/openagent-wordmark.png');
  const screenshotUrl = useBaseUrl('/openagent-canvas-screenshot.png');

  return (
    <Layout
      title="Documentation"
      description="Documentation for OpenAgent, the local-first Codex workflow built around Obsidian Canvas.">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>Documentation</p>
                <div className={styles.brandLockup}>
                  <img
                    className={styles.wordmark}
                    src={wordmarkUrl}
                    alt="OpenAgent"
                  />
                </div>
                <Heading as="h1" className={styles.srOnly}>
                  {siteConfig.title}
                </Heading>
                <p className={styles.subtitle}>{siteConfig.tagline}</p>
                <p className={styles.summary}>
                  Pick the path that matches why you are here: evaluate the product,
                  install it, use it in Obsidian, run the mobile flow, or contribute
                  to the repo.
                </p>
                <div className={styles.actions}>
                  <DocLink className="button button--primary" href="/docs/evaluate-openagent">
                    Choose a path
                  </DocLink>
                  <DocLink className={styles.textAction} href="/docs/use-openagent-in-obsidian">
                    See the main Obsidian flow
                  </DocLink>
                </div>
              </div>
              <div className={styles.preview}>
                <div className={styles.previewLabel}>Workspace preview</div>
                <img
                  className={styles.previewImage}
                  src={screenshotUrl}
                  alt="OpenAgent running inside Obsidian Canvas"
                />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Choose Your Path</Heading>
              <p>
                OpenAgent has a few distinct audiences. Start with the path that
                matches your job instead of guessing between concepts and engineering.
              </p>
            </div>
            <div className={styles.sectionGrid}>
              {paths.map((section) => (
                <article className={styles.card} key={section.title}>
                  <Heading as="h3">{section.title}</Heading>
                  <p className={styles.cardDescription}>{section.description}</p>
                  <div className={styles.linkList}>
                    {section.links.map((link) => (
                      <DocLink className={styles.linkRow} key={link.href} href={link.href}>
                        <span>{link.label}</span>
                        <span className={styles.arrow}>↗</span>
                      </DocLink>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <Heading as="h2">Reference</Heading>
              <p>
                Once you are on the right path, these deeper docs explain the
                product model, implementation details, and active research.
              </p>
            </div>
            <div className={styles.sectionGrid}>
              {references.map((section) => (
                <article className={styles.card} key={section.title}>
                  <Heading as="h3">{section.title}</Heading>
                  <p className={styles.cardDescription}>{section.description}</p>
                  <div className={styles.linkList}>
                    {section.links.map((link) => (
                      <DocLink className={styles.linkRow} key={link.href} href={link.href}>
                        <span>{link.label}</span>
                        <span className={styles.arrow}>↗</span>
                      </DocLink>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
