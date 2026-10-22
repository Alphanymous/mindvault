import { useEffect, useRef, useState } from 'react'
import { captureFile, captureText, type CaptureResult } from '../import/capture'
import { Icon } from './Icon'
import { toast } from './toast'

export function Capture({ onClose, initial = '' }: { onClose(): void; initial?: string }) {
  const [text, setText] = useState(initial)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => ta.current?.focus(), [])

  const save = async () => {
    if (busy) return
    if (!text.trim() && files.length === 0) return
    setBusy(true)
    const results: CaptureResult[] = []
    if (text.trim()) results.push(await captureText(text))
    for (const f of files) results.push(await captureFile(f))
    setBusy(false)
    const saved = results.filter((r) => r.item).length
    for (const r of results) {
      if (r.error) toast(r.error, 'error')
      else if (r.warning) toast(r.warning, 'warn')
    }
    if (saved) {
      toast(`Saved ${saved} item${saved === 1 ? '' : 's'} to your inbox`, 'ok', { label: 'Review', href: '#/inbox' })
      onClose()
    }
  }

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((f) => [...f, ...Array.from(list)])
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={`capture glass ${drag ? 'drag' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        role="dialog"
        aria-label="Quick capture"
      >
        <div className="capture-head">
          <h2>Quick capture</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save() }}
          placeholder="Paste a link to clip a page, paste a prompt, or just write. Drop PDFs and files here."
          rows={6}
        />
        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={i}>
                <Icon name={f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'file'} size={15} /> {f.name}
                <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="capture-foot">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          <button className="btn" onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} /> Add files</button>
          <span className="muted small">Ctrl+Enter to save</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || (!text.trim() && !files.length)} onClick={save}>
            {busy ? 'Saving…' : 'Save to inbox'}
          </button>
        </div>
      </div>
    </div>
  )
}
