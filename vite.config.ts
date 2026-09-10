import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages 서브패스 배포: 저장소명 blog-publisher
export default defineConfig({
  base: '/blog-publisher/',
  plugins: [react()],
})
