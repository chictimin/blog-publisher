import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles.css'
import App from './App.tsx'

// GitHub Pages는 SPA 경로를 네이티브 지원하지 않으므로 HashRouter를 쓴다.
// 라우팅은 `#/`만 사용한다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
