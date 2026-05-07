import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import CategorySwitcher from './components/CategorySwitcher.vue'
import './style.css'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CategorySwitcher', CategorySwitcher)
  },
}

export default theme
