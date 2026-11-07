import { useAppState } from '../data/store'
import { HostPanel, PeerPanel } from './PairPanels'
import { href, type Route } from './router'
import { AboutTab } from './settings/AboutTab'
import { CaptureTab } from './settings/CaptureTab'
import { DataTab } from './settings/DataTab'
import { DriveCard } from './settings/DriveCard'
import { FolderCard } from './settings/FolderCard'
import { GeneralTab } from './settings/GeneralTab'
import { Icon } from './Icon'

type SettingsRoute = Extract<Route, { name: 'settings' }>

const TABS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'sync', label: 'Sync', icon: 'cloud' },
  { id: 'capture', label: 'Capture', icon: 'web' },
  { id: 'data', label: 'Data', icon: 'download' },
  { id: 'about', label: 'About', icon: 'graph' },
] as const

function SyncTab() {
  const desktop = !!window.mindvault?.pair
  // Your computer is the sync hub. Google Drive stays available only for people who already set it up.
  const { settings } = useAppState()
  const driveSetUp = !!settings.googleClientId
  return (
    <>
      {desktop ? (
        <>
          <HostPanel />
          <FolderCard />
        </>
      ) : (
        <PeerPanel />
      )}
      {driveSetUp && (
        <details className="more-ways">
          <summary>Google Drive (set up earlier)</summary>
          <DriveCard />
        </details>
      )}
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
          <p className="sub">Everything is stored on this device. Your computer is the hub that keeps your phones in sync.</p>
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
        {tab === 'data' && <DataTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}
