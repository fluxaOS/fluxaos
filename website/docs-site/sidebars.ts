import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
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
        { type: 'doc', id: 'guides/first-setup', label: '1. First Setup' },
        { type: 'doc', id: 'guides/build-a-pipeline', label: '2. Build a Pipeline' },
        { type: 'doc', id: 'guides/add-an-issue', label: '3. Add an Issue' },
        { type: 'doc', id: 'guides/run-a-pipeline', label: '4. Run a Pipeline' },
        { type: 'doc', id: 'guides/read-the-results', label: '5. Read the Results' },
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
