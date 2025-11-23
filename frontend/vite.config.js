import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/baidu': {
        target: 'https://qianfan.baidubce.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/baidu/, '/v2/ai_search/chat/completions'),
      },
      '/api/volc': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/volc/, '/api/v3/chat/completions'),
      },
    },
  },
})
