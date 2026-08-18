import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 部署在 GitHub Pages 子路径下，需设为仓库名
  base: '/pdf-splitter/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 拆分 vendor，让 react/antd/pdf 独立 chunk 并行加载、长期缓存
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
          if (/node_modules\/(antd|@ant-design|rc-|@rc-component)\//.test(id)) return 'antd-vendor'
          if (/node_modules\/(pdfjs-dist|pdf-lib)\//.test(id)) return 'pdf'
        },
      },
    },
  },
})
