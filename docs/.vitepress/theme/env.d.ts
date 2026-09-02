declare module "@phenodocs-theme" {
  import type { Theme } from "vitepress";
  const PhenoDocsTheme: Theme.Theme;
  export default PhenoDocsTheme;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
