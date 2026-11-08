import { defineConfig } from 'vitepress'

const repo = 'KooshaPari/Benchora'
const siteBase = '/Benchora/'

export default defineConfig({
  title: 'Benchora',
  description: 'Modern benchmarking + xDD testing framework for Rust (gauge).',
  lang: 'en-US',
  base: siteBase,
  srcDir: '.',
  outDir: '.vitepress/dist',
  cacheDir: '.vitepress/cache',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0b3d91' }]
  ],
  repo,
  editLink: {
    pattern: `${repo}/edit/main/docs/:path`,
    text: 'Edit this page on GitHub'
  },
  themeConfig: {
    siteTitle: 'Benchora',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Repository',
        link: `https://github.com/${repo}`
      }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Getting Started', link: '/getting-started' }
        ]
      },
      {
        text: 'Reference',
        items: [{ text: 'SLSA', link: '/slsa' }]
      }
    ],
    socialLinks: [{ icon: 'github', link: `https://github.com/${repo}` }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © ${new Date().getFullYear()} Benchora contributors.`
    }
  }
})
