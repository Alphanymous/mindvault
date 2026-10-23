import { isNativeApp } from '../../import/web'
import { Section } from './parts'

declare const __APP_VERSION__: string

export function AboutTab() {
  const where = window.mindvault?.platform === 'electron' ? 'Windows app' : isNativeApp() ? 'Android app' : 'web app'
  return (
    <>
      <Section icon="graph" title={`Mindvault ${__APP_VERSION__}`}>
        <p className="muted">Running as the {where}. Everything is stored on this device; sync and AI are optional.</p>
        <ul className="plain">
          <li>Home dashboard, smart collections, prompt toolbox</li>
          <li>PDF and web reader with highlights that link back to the page</li>
          <li>Search by words, topics and (optionally) meaning; related notes and suggested links</li>
          <li>Pair your phone over Wi-Fi, sync through Google Drive, share to Mindvault on Android</li>
        </ul>
      </Section>
      <Section icon="file" title="Guides">
        <p className="muted">The guides ship in the project&rsquo;s <code>docs</code> folder: Google Drive setup, phone pairing and the browser clipper, and the full feature guide. MIT licensed.</p>
      </Section>
    </>
  )
}
