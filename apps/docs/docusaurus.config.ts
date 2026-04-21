import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OpenAgent Docs',
  tagline: 'From thought to action.',
  favicon: 'img/openagent-panel-logo.png',
  future: {
    v4: true,
  },
  url: 'https://openagent-market-docs.web.app',
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
      logo: {
        alt: 'OpenAgent',
        src: 'img/openagent-panel-logo.png',
        srcDark: 'img/openagent-panel-logo.png',
        width: 32,
        height: 32,
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'openagentDocs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/getting-started/user-guide',
          label: 'User Guide',
          position: 'left',
        },
        {
          to: '/docs/engineering/architecture',
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
              to: '/docs/getting-started/user-guide',
            },
            {
              label: 'Project Map',
              to: '/docs/concepts/project-map',
            },
          ],
        },
        {
          title: 'Build',
          items: [
            {
              label: 'Architecture',
              to: '/docs/engineering/architecture',
            },
            {
              label: 'Plugin Development',
              to: '/docs/engineering/plugin-development',
            },
            {
              label: 'Mobile Guide',
              to: '/docs/getting-started/mobile-guide',
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
              to: '/docs/getting-started/manual-install',
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
