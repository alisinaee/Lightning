import '../assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GrantPanel } from './GrantPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GrantPanel />
  </StrictMode>
)
