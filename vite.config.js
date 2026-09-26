import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/multibaas-api': {
        target: process.env.VITE_MULTIBAAS_URL || 'https://iwffrp3hnzcxnchaguvilywqsi.multibaas.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/multibaas-api/, ''),
      },
    },
  },
})
