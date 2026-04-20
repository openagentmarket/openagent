import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OpenAgent Docs',
  tagline: 'Local-first Codex orchestration through Obsidian Canvas.',
  favicon: 'img/favicon.ico',
  future: {
    v4: true,
  },
  url: 'http://localhost:3000',
  baseUrl: '/',
  organizationName: 'openagentmarket',
  projectName: 'openagent',
  onBrokenLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  staticDirectories: ['static', '../../docs/images'],
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../../docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          showLastUpdateTime: true,
          editUrl: 'https://github.com/openagentmarket/openagent/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'openagent-canvas-screenshot.png',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'OpenAgent',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'openagentDocs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/USER_GUIDE',
          label: 'User Guide',
          position: 'left',
        },
        {
          to: '/docs/ARCHITECTURE',
          label: 'Architecture',
          position: 'left',
        },
        {
          href: 'https://github.com/openagentmarket/openagent',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Start Here',
          items: [
            {
              label: 'User Guide',
              to: '/docs/USER_GUIDE',
            },
            {
              label: 'Project Map',
              to: '/docs/PROJECT_MAP',
            },
          ],
        },
        {
          title: 'Build',
          items: [
            {
              label: 'Architecture',
              to: '/docs/ARCHITECTURE',
            },
            {
              label: 'Plugin Development',
              to: '/docs/OBSIDIAN_PLUGIN_DEV',
            },
            {
              label: 'Mobile Guide',
              to: '/docs/CONVOS_MOBILE_GUIDE',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Repo',
              href: 'https://github.com/openagentmarket/openagent',
            },
            {
              label: 'Manual Install',
              to: '/docs/MANUAL_INSTALL',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} OpenAgent. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
