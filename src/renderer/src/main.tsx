import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppBoundary } from './components/AppBoundary'
import { LogsDialog } from './components/LogsDialog'
import './utils/errorLog'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
    <LogsDialog />
  </StrictMode>
)
