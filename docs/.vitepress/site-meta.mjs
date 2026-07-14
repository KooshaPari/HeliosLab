export function createSiteMeta({ base = "/" } = {}) {
  return {
    base,
    title: "apps/heliosApp-colab",
    description: "Documentation",
    themeConfig: {
      nav: [
        { text: "Home", link: base || "/" },
        { text: "Guide", link: "/guide/" },
      ],
    },
  };
}
