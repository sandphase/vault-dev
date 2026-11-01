import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  server: {
    proxy: {
      '/sys': {
        target: 'http://localhost:8200',
        changeOrigin: true
      },
      '/auth': {
        target: 'http://localhost:8200',
        changeOrigin: true
      },
      '/secret': {
        target: 'http://localhost:8200',
        changeOrigin: true
      }
    }
  }
})
