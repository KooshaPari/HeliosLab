import { defineConfig } from 'vitepress'

const isPagesBuild = process.env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_PAGES === 'true'
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'colab'
const docsBase = isPagesBuild ? `/${repoName}/` : '/'

export default defineConfig({
  title: 'co(lab)',
  description: 'Collaborative development platform',
  lang: 'en-US',
  base: docsBase,
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'co(lab)',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' }
    ],
    sidebar: {
      '/guide/': [
        { text: 'Guide', items: [{ text: 'Getting Started', link: '/guide/getting-started' }] }
      ]
    },
    socialLinks: [{ icon: 'github', link: `https://github.com/kooshapari/${repoName}` }],
    search: { provider: 'local' }
  },
  markdown: { lineNumbers: true },
  ignoreDeadLinks: true
})
