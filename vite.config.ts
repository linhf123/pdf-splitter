import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 部署在 GitHub Pages 子路径下，需设为仓库名
  base: '/pdf-splitter/',
  plugins: [react()],
})
