import { useState, type ReactNode } from 'react'
import type { TestResult } from '../../core/providers'
import { Icon } from '../Icon'

export type StatusKind = 'ok' | 'warn' | 'off'

export function Status({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return <span className={`status ${kind}`}><i />{children}</span>
}

export function Section({ icon, title, status, children }: { icon: string; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel settings-section">
      <header className="section-title">
        <h3><Icon name={icon} size={18} /> {title}</h3>
        {status}
      </header>
      {children}
    </section>
  )
}

/** Runs an async check and shows the plain-language result underneath. */
export function TestButton({ label, run, disabled, primary }: { label: string; run(): Promise<TestResult>; disabled?: boolean; primary?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  return (
    <div className="test">
      <button
        className={`btn ${primary ? 'primary' : ''}`}
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true)
          setResult(null)
          setResult(await run())
          setBusy(false)
        }}
      >
        <Icon name={result?.ok ? 'check' : 'refresh'} size={16} /> {busy ? 'Testing…' : label}
      </button>
      {result && <p className={`test-result ${result.ok ? 'ok' : 'bad'}`} role="status">{result.message}</p>}
    </div>
  )
}

export function SecretInput({ value, onChange, placeholder, label }: { value: string; onChange(v: string): void; placeholder?: string; label: string }) {
  const [shown, setShown] = useState(false)
  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret">
        <input type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" />
        <button type="button" className="icon-btn" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide' : 'Show'}>
          <Icon name="eye" size={16} />
        </button>
      </div>
    </label>
  )
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>
}

export function Step({ done, title, children }: { done?: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={`step ${done ? 'done' : ''}`}>
      <span className="step-mark">{done ? <Icon name="check" size={14} /> : null}</span>
      <div>
        <b>{title}</b>
        {children && <div className="step-body">{children}</div>}
      </div>
    </li>
  )
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="ext-link" href={href} target="_blank" rel="noopener noreferrer">
      {children} <Icon name="external" size={13} />
    </a>
  )
}
