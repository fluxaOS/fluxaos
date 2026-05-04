import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'fluxaOS Docs',
  tagline: 'AI orchestration OS — documentation',
  favicon: 'img/logo.svg',

  url: 'https://docs.fluxaos.io',
  baseUrl: '/',

  organizationName: 'fluxaOS',
  projectName: 'fluxaos',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/fluxaOS/fluxaos/tree/main/website/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'fluxaOS',
      logo: {
        alt: 'fluxaOS Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://fluxaos.io',
          label: 'Home',
          position: 'right',
        },
        {
          href: 'https://github.com/fluxaOS/fluxaos',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} fluxaOS.`,
    },
    prism: {
      theme: { plain: { color: '#393A34', backgroundColor: '#f6f8fa' }, styles: [] },
      darkTheme: { plain: { color: '#F8F8F2', backgroundColor: '#282A36' }, styles: [] },
      additionalLanguages: ['bash', 'yaml', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
