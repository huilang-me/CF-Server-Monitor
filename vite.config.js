import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: true, cssCodeSplit: true }
})
