import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'
import { themes as prismThemes } from 'prism-react-renderer'

const REPO = 'https://github.com/juhyeonni/gas-sheets-query'

const config: Config = {
  title: 'gas-sheets-query',
  tagline: 'Use Google Sheets as a typed database in Google Apps Script',
  favicon: 'img/favicon.ico',

  url: 'https://juhyeonni.github.io',
  baseUrl: '/gas-sheets-query/',
  organizationName: 'juhyeonni',
  projectName: 'gas-sheets-query',

  onBrokenLinks: 'throw',
  future: { v4: true },

  // Docs are plain CommonMark; MDX would choke on TS generics in prose.
  markdown: {
    format: 'detect',
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: `${REPO}/edit/main/website/`,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-llms',
      {
        // routeBasePath is '/', so URLs must not get a 'docs' prefix.
        docsDir: [{ path: 'docs', routeBasePath: '/' }],
        generateLLMsFullTxt: true,
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'gas-sheets-query',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        {
          href: 'https://www.npmjs.com/package/@gsquery/core',
          label: 'npm',
          position: 'right',
        },
        { href: REPO, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Installation', to: '/installation' },
            { label: 'Quick Start', to: '/quick-start' },
            { label: 'API Reference', to: '/api-reference' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: REPO },
            { label: 'npm: @gsquery/core', href: 'https://www.npmjs.com/package/@gsquery/core' },
            { label: 'Issues', href: `${REPO}/issues` },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} juhyeonni. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
