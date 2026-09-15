import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    'index',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['installation', 'quick-start', 'schema-definition'],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: ['architecture-overview', 'adapters', 'id-modes'],
    },
    {
      type: 'category',
      label: 'Usage Guide',
      items: [
        'crud-operations',
        'query-builder',
        'join-queries',
        'aggregation',
        'batch-operations',
        'testing',
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'migration-system',
        'cli-reference',
        'typed-client',
        'local-first-client',
        'indexing-and-performance',
        'operations',
        'ai-assistant-skills',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['error-handling', 'api-reference'],
    },
  ],
}

export default sidebars
