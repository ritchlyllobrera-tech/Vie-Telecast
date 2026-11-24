import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// order matters: later files override earlier ones
import './telecast/styles/base.css'
import './telecast/styles/control.css'
import './telecast/styles/stage.css'
import './telecast/styles/ice.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
