import { CLIP_PROXY_PRESETS, describeClipSetup } from '../../core/providers'
import { testClipDownload } from '../../data/connections'
import { saveSettings, useAppState } from '../../data/store'
import { isNativeApp } from '../../import/web'
import { ClipperPanel } from '../PairPanels'
import { Section, Status, TestButton } from './parts'

export function CaptureTab() {
  const { settings } = useAppState()
  const electron = window.mindvault?.platform === 'electron'
  const setup = describeClipSetup({ electron, native: isNativeApp(), proxy: settings.clipProxy })
  const builtIn = setup.route === 'desktop' || setup.route === 'android'
  const preset = CLIP_PROXY_PRESETS.find((p) => p.template === settings.clipProxy)
  const mode = !settings.clipProxy ? 'none' : preset ? preset.id : 'custom'

  return (
    <>
      <Section
        icon="web"
        title="Downloading web pages"
        status={<Status kind={setup.ready ? 'ok' : 'warn'}>{setup.ready ? 'Ready' : 'Needs a proxy'}</Status>}
      >
        <p className="muted">{setup.text}</p>

        {!builtIn && (
          <>
            <label className="field">
              <span>Download method</span>
              <select
                value={mode}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'none') void saveSettings({ clipProxy: '' })
                  else if (v === 'custom') void saveSettings({ clipProxy: settings.clipProxy || 'https://' })
                  else void saveSettings({ clipProxy: CLIP_PROXY_PRESETS.find((p) => p.id === v)!.template })
                }}
              >
                <option value="none">Save links only (no page text)</option>
                {CLIP_PROXY_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">My own proxy…</option>
              </select>
            </label>
            {preset && <p className="hint">{preset.note}</p>}
            {mode === 'custom' && (
              <label className="field">
                <span>Proxy address</span>
                <input value={settings.clipProxy} onChange={(e) => saveSettings({ clipProxy: e.target.value })} placeholder="https://my-proxy.example/?url={url}" spellCheck={false} />
                <span className="hint">Use <code>{'{url}'}</code> where the page address goes. The proxy must return the page&rsquo;s HTML.</span>
              </label>
            )}
          </>
        )}

        <TestButton label="Test page download" run={testClipDownload} disabled={!setup.ready} />
        <p className="muted small">Pasted links are downloaded, cleaned to readable text and filed automatically. If a download fails, the link is still saved.</p>
      </Section>

      <ClipperPanel />
    </>
  )
}
