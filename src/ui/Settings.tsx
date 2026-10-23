import { HostPanel, PeerPanel } from './PairPanels'
import { href, type Route } from './router'
import { AboutTab } from './settings/AboutTab'
import { AiTab } from './settings/AiTab'
import { CaptureTab } from './settings/CaptureTab'
import { DataTab } from './settings/DataTab'
import { DriveCard } from './settings/DriveCard'
import { GeneralTab } from './settings/GeneralTab'
import { Icon } from './Icon'

type SettingsRoute = Extract<Route, { name: 'settings' }>

const TABS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'sync', label: 'Sync', icon: 'cloud' },
  { id: 'capture', label: 'Capture', icon: 'web' },
  { id: 'ai', label: 'AI', icon: 'sparkle' },
  { id: 'data', label: 'Data', icon: 'download' },
  { id: 'about', label: 'About', icon: 'graph' },
] as const

function SyncTab() {
  const desktop = !!window.mindvault?.pair
  return (
    <>
      <DriveCard />
      {desktop ? <HostPanel /> : <PeerPanel />}
    </>
  )
}

export function Settings({ route }: { route?: SettingsRoute }) {
  const tab = TABS.find((t) => t.id === route?.tab)?.id ?? 'general'
  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Everything is stored on this device. Each connection below has a test button, so you know it works.</p>
        </div>
      </header>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <a key={t.id} href={href({ name: 'settings', tab: t.id })} className={`tab-pill ${tab === t.id ? 'on' : ''}`} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} size={16} /> {t.label}
          </a>
        ))}
      </nav>
      <div className="settings-body">
        {tab === 'general' && <GeneralTab />}
        {tab === 'sync' && <SyncTab />}
        {tab === 'capture' && <CaptureTab />}
        {tab === 'ai' && <AiTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}
