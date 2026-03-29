export function createSiteMeta({ base = '/' } = {}) {
  return {
    base,
    title: 'services/colab',
    description: 'services/colab documentation',
    themeConfig: {
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Guide', link: '/guide/' }
      ]
    }
  }
}
