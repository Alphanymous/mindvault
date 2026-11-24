import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource-variable/jetbrains-mono'
import './ui/styles.css'
import './ui/glass.css'
import { App } from './ui/App'
import { initStore } from './data/store'
import { registerPeerHost } from './sync/peerHost'
import { setupServiceWorker } from './pwa'
import { watchUncaughtErrors } from './data/errorLog'

watchUncaughtErrors()
registerPeerHost()
setupServiceWorker()
initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
