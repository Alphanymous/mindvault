import { SHORTCUT_HELP } from '../core/keys'
import { Icon } from './Icon'

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="capture glass" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="capture-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <ul className="keys">
          {SHORTCUT_HELP.map((s) => (
            <li key={s.keys}>
              <span className="keycaps">{s.keys.split(' ').filter(Boolean).map((k, i) => (k === 'or' ? <em key={i}>or</em> : <kbd key={i}>{k}</kbd>))}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Letter shortcuts work when you are not typing in a field. Press Esc to close anything.</p>
      </div>
    </div>
  )
}
