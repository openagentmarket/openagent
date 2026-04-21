import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  openagentDocs: [
    'intro',
    {
      type: 'category',
      label: 'Choose Your Path',
      items: [
        'evaluate-openagent',
        'install-openagent',
        'use-openagent-in-obsidian',
        'getting-started/mobile-guide',
        'contribute-to-openagent',
      ],
    },
    {
      type: 'category',
      label: 'Use OpenAgent',
      items: [
        'getting-started/user-guide',
        'getting-started/manual-install',
        'concepts/obsidian-canvas',
        'concepts/group-context',
      ],
    },
    {
      type: 'category',
      label: 'Build And Maintain',
      items: [
        'concepts/project-map',
        'engineering/architecture',
        'engineering/plugin-development',
        'engineering/plugin-release',
        'engineering/task-stream-flow',
      ],
    },
    {
      type: 'category',
      label: 'Notes',
      items: [
        'notes/safe-skill-sandbox-mvp',
        'notes/canvas-image-support',
      ],
    },
  ],
};

export default sidebars;
