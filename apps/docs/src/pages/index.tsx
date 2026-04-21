import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

const sections = [
  {
    title: 'Get started',
    description: 'The fastest path to using OpenAgent inside an Obsidian vault.',
    links: [
      {label: 'User guide', href: '/docs/getting-started/user-guide'},
      {label: 'Manual install', href: '/docs/getting-started/manual-install'},
      {label: 'Convos mobile guide', href: '/docs/getting-started/mobile-guide'},
    ],
  },
  {
    title: 'Build and debug',
    description: 'Understand the runtime, plugin workflow, and release process.',
    links: [
      {label: 'Architecture', href: '/docs/engineering/architecture'},
      {label: 'Plugin development', href: '/docs/engineering/plugin-development'},
      {label: 'Plugin release', href: '/docs/engineering/plugin-release'},
    ],
  },
  {
    title: 'Concepts',
    description: 'Use the repo map and product notes when you need more detail.',
    links: [
      {label: 'Project map', href: '/docs/concepts/project-map'},
      {label: 'Canvas reference', href: '/docs/concepts/obsidian-canvas'},
      {label: 'Group context', href: '/docs/concepts/group-context'},
    ],
  },
  {
    title: 'Notes',
    description: 'Product specs and implementation notes that support ongoing work.',
    links: [
      {label: 'Task stream flow', href: '/docs/engineering/task-stream-flow'},
      {label: 'Safe skill sandbox MVP', href: '/docs/notes/safe-skill-sandbox-mvp'},
      {label: 'Canvas image support research', href: '/docs/notes/canvas-image-support'},
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
                  OpenAgent turns an Obsidian Canvas selection into a durable
                  Codex task and writes the result back into the graph. This
                  site pulls directly from the repo&apos;s markdown docs.
                </p>
                <div className={styles.actions}>
                  <Link className="button button--primary" to="/docs/">
                    Get started
                  </Link>
                  <Link className={styles.textAction} to="/docs/concepts/project-map">
                    Explore the project map
                  </Link>
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
              <Heading as="h2">Browse the docs</Heading>
              <p>
                A simple index for the guides, architecture notes, and working
                documents already tracked in this repository.
              </p>
            </div>
            <div className={styles.sectionGrid}>
              {sections.map((section) => (
                <article className={styles.card} key={section.title}>
                  <Heading as="h3">{section.title}</Heading>
                  <p className={styles.cardDescription}>{section.description}</p>
                  <div className={styles.linkList}>
                    {section.links.map((link) => (
                      <Link className={styles.linkRow} key={link.href} to={link.href}>
                        <span>{link.label}</span>
                        <span className={styles.arrow}>↗</span>
                      </Link>
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
