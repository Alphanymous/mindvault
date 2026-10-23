import { saveSettings, useAppState } from '../../data/store'
import { Icon } from '../Icon'
import { dictationSupported } from '../useDictation'
import { Section, Status } from './parts'

export function GeneralTab() {
  const { settings } = useAppState()
  const voice = dictationSupported()
  return (
    <>
      <Section icon="eye" title="Appearance">
        <p className="muted">Black and gold by default. Light mode is warm paper with the same gold.</p>
        <div className="seg">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => saveSettings({ theme: t })}>
              {t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Section>

      <Section icon="search" title="Keyboard and voice" status={<Status kind={voice ? 'ok' : 'off'}>{voice ? 'Voice available' : 'No voice here'}</Status>}>
        <p className="muted">
          Press <kbd>Ctrl K</kbd> anywhere to search; type <kbd>&gt;</kbd> for commands, <kbd>#</kbd> for tags, <kbd>@</kbd> for folders. Letter shortcuts such as <kbd>g</kbd> <kbd>i</kbd> and <kbd>c</kbd> work when you are not typing.
        </p>
        <div className="row">
          <button className="btn" onClick={() => window.dispatchEvent(new Event('mv:help'))}><Icon name="search" size={16} /> Show all shortcuts</button>
        </div>
        <p className="muted small">
          {voice
            ? 'Capture → Dictate turns speech into text using your browser’s speech service.'
            : 'Dictation needs a browser with the speech service (Chrome, Edge, Safari). The desktop and Android apps do not include one; use the microphone key on your keyboard instead.'}
        </p>
      </Section>
    </>
  )
}
