import { useState } from 'react'
import { clearErrors, formatErrors, readErrors } from '../../data/errorLog'
import { isNativeApp } from '../../import/web'
import { toast } from '../toast'
import { copyText } from '../util'
import { Section } from './parts'

declare const __APP_VERSION__: string

export function AboutTab() {
  const where = window.mindvault?.platform === 'electron' ? 'Windows app' : isNativeApp() ? 'Android app' : 'web app'
  return (
    <>
      <Section icon="graph" title={`Mindvault ${__APP_VERSION__}`}>
        <p className="muted">Running as the {where}. Everything is stored on this device; sync is optional.</p>
        <ul className="plain">
          <li>Home dashboard, smart collections, prompt toolbox</li>
          <li>PDF and web reader with highlights that link back to the page</li>
          <li>Search by words and topics, related notes and suggested links</li>
          <li>Pair your phone over Wi-Fi, sync through Google Drive, share to Mindvault on Android</li>
        </ul>
      </Section>
      <ErrorLog where={where} />
      <Section icon="file" title="Guides">
        <p className="muted">The guides ship in the project&rsquo;s <code>docs</code> folder: Google Drive setup, phone pairing and the browser clipper, and the full feature guide. MIT licensed.</p>
      </Section>
    </>
  )
}

/** Recent failures on this device, copyable for a bug report. */
function ErrorLog({ where }: { where: string }) {
  const [errors, setErrors] = useState(readErrors)
  const copy = async () => toast((await copyText(formatErrors(__APP_VERSION__, where))) ? 'Copied. Paste it into a message.' : 'Copy was blocked.', 'ok')
  return (
    <Section icon="help" title={`Recent problems${errors.length ? ` (${errors.length})` : ''}`}>
      {errors.length === 0 ? (
        <p className="muted">Nothing has gone wrong on this device. If something fails, the exact error is listed here.</p>
      ) : (
        <>
          <ul className="plain error-log">
            {errors.slice(0, 8).map((e) => (
              <li key={e.at + e.message}>
                <span className="muted small">{new Date(e.at).toLocaleString()} · {e.where}</span>
                <br />
                {e.message}
                {e.detail && <span className="muted small"> — {e.detail}</span>}
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn" onClick={copy}>Copy report</button>
            <button className="btn ghost" onClick={() => { clearErrors(); setErrors([]) }}>Clear</button>
          </div>
        </>
      )}
    </Section>
  )
}
