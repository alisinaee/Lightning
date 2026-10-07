import '../assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TrayPanel } from './TrayPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrayPanel />
  </StrictMode>
)
