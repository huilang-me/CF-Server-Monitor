import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'cfsm-runtime-meta',
      transformIndexHtml(html) {
        return html
          .replace('__CFSM_API_BASE__', process.env.VITE_API_BASE || '')
      }
    }
  ],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true, cssCodeSplit: true }
})
