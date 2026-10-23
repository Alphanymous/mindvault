import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/styles.css'
import { App } from './ui/App'
import { initStore } from './data/store'
import { registerPeerHost } from './sync/peerHost'

registerPeerHost()
initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
