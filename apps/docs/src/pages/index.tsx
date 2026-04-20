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
      {label: 'User guide', href: '/docs/USER_GUIDE'},
      {label: 'Manual install', href: '/docs/MANUAL_INSTALL'},
      {label: 'Convos mobile guide', href: '/docs/CONVOS_MOBILE_GUIDE'},
    ],
  },
  {
    title: 'Build and debug',
    description: 'Understand the runtime, plugin workflow, and release process.',
    links: [
      {label: 'Architecture', href: '/docs/ARCHITECTURE'},
      {label: 'Plugin development', href: '/docs/OBSIDIAN_PLUGIN_DEV'},
      {label: 'Plugin release', href: '/docs/OBSIDIAN_PLUGIN_RELEASE'},
    ],
  },
  {
    title: 'Reference',
    description: 'Use the repo map and product notes when you need more detail.',
    links: [
      {label: 'Project map', href: '/docs/PROJECT_MAP'},
      {label: 'Canvas reference', href: '/docs/OBSIDIAN_CANVAS_REFERENCE'},
      {label: 'Group context', href: '/docs/GROUP_CONTEXT'},
    ],
  },
  {
    title: 'Working notes',
    description: 'Product specs and implementation notes that support ongoing work.',
    links: [
      {label: 'Task stream flow', href: '/docs/OBSIDIAN_TASK_STREAM_FLOW'},
      {label: 'Safe skill sandbox MVP', href: '/docs/SAFE_SKILL_SANDBOX_MVP'},
      {label: 'Canvas image support research', href: '/docs/CANVAS_IMAGE_SUPPORT_RESEARCH'},
    ],
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
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
                <Heading as="h1" className={styles.title}>
                  {siteConfig.title}
                </Heading>
                <p className={styles.subtitle}>{siteConfig.tagline}</p>
                <p className={styles.summary}>
                  OpenAgent turns an Obsidian Canvas selection into a durable
                  Codex task and writes the result back into the graph. This
                  site pulls directly from the repo&apos;s markdown docs.
                </p>
                <div className={styles.actions}>
                  <Link className="button button--primary" to="/docs/USER_GUIDE">
                    Get started
                  </Link>
                  <Link className={styles.textAction} to="/docs/PROJECT_MAP">
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
