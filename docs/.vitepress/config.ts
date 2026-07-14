import { defineConfig } from "vitepress";

export default defineConfig({
  vite: {
    ssr: {
      noExternal: [],
    },
    build: {
      rollupOptions: {
        external: ["vue/server-renderer"],
      },
    },
  },
  title: "Documentation",
  description: "Unified documentation",
  base: process.env.GITHUB_ACTIONS ? "/heliosApp/" : "/",
  srcDir: ".",
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Wiki", link: "/wiki/" },
      { text: "Development Guide", link: "/development/" },
      { text: "DevOps", link: "/wiki/devops-cicd" },
      { text: "Document Index", link: "/index/" },
      { text: "API", link: "/api/" },
      { text: "Roadmap", link: "/roadmap/" },
    ],
    sidebar: {
      "/wiki/": [
        {
          text: "Wiki",
          items: [
            { text: "Overview", link: "/wiki/" },
            { text: "DevOps and CI/CD", link: "/wiki/devops-cicd" },
          ],
        },
      ],
      "/development/": [
        {
          text: "Development Guide",
          items: [{ text: "Overview", link: "/development/" }],
        },
      ],
      "/index/": [
        {
          text: "Document Index",
          items: [
            { text: "Overview", link: "/index/" },
            { text: "Raw/All", link: "/index/raw-all" },
            { text: "Planning", link: "/index/planning" },
            { text: "Specs", link: "/index/specs" },
            { text: "Research", link: "/index/research" },
            { text: "Worklogs", link: "/index/worklogs" },
            { text: "Other", link: "/index/other" },
          ],
        },
      ],
      "/api/": [{ text: "API", items: [{ text: "Overview", link: "/api/" }] }],
      "/roadmap/": [{ text: "Roadmap", items: [{ text: "Overview", link: "/roadmap/" }] }],
      "/": [
        {
          text: "Quick Links",
          items: [
            { text: "Wiki", link: "/wiki/" },
            { text: "Development Guide", link: "/development/" },
            { text: "DevOps", link: "/wiki/devops-cicd" },
            { text: "Document Index", link: "/index/" },
            { text: "API", link: "/api/" },
            { text: "Roadmap", link: "/roadmap/" },
          ],
        },
      ],
    },
    search: { provider: "local" },
  },
});
