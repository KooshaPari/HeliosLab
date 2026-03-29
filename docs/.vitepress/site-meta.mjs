export function createSiteMeta({ base = '/' } = {}) {
  return {
    base,
    title: 'services/colab',
    description: 'services/colab documentation',
    themeConfig: {
      nav: [
        { text: 'Home', link: base || '/' },
        { text: 'Guide', link: '/guide/' }
      ]
    }
  }
}
