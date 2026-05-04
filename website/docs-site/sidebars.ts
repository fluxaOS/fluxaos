import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'doc',
      id: 'index',
      label: 'Overview',
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/index',
        'concepts/skills',
        'concepts/drivers',
        'concepts/pipelines',
        'concepts/gates',
        'concepts/signals',
        'concepts/state-vs-status',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/first-setup',
        'guides/build-a-pipeline',
        'guides/add-an-issue',
        'guides/run-a-pipeline',
        'guides/read-the-results',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/env-vars',
        'reference/signal-types',
        'reference/gate-rules',
        'reference/issue-states',
        'reference/playbook-schema',
        'reference/daemon',
      ],
    },
  ],
};

export default sidebars;
