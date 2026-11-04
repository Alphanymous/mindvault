import { useEffect, useRef, useState } from 'react'
import { captureFile, captureText, captureImageWithOCR, type CaptureResult } from '../import/capture'
import { Icon } from './Icon'
import { toast } from './toast'
import { useDictation } from './useDictation'

export function Capture({ onClose, initial = '', dictate = false }: { onClose(): void; initial?: string; dictate?: boolean }) {
  const [text, setText] = useState(initial)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const voice = useDictation((chunk) => setText((t) => (t && !t.endsWith(' ') && !t.endsWith('\n') ? t + ' ' : t) + chunk))

  useEffect(() => {
    ta.current?.focus()
    if (dictate && voice.supported) voice.start()
    else if (dictate) toast('Voice input is not available here. Use the microphone key on your keyboard.', 'warn')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (busy) return
    if (voice.listening) voice.stop()
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
      toast(`Saved ${saved} item${saved === 1 ? '' : 's'} `, 'ok', { label: 'View', href: '#/library?c=new' })
      onClose()
    }
  }

  const handleImageCapture = async (file: File) => {
    if (ocrBusy) return
    setOcrBusy(true)
    try {
      const result = await captureImageWithOCR(file, 'Screenshot')
      if (result.item) {
        if (result.warning) toast(result.warning, 'warn')
        else toast('Image saved with its text', 'ok', { label: 'View', href: '#/library?c=new' })
        onClose()
      } else if (result.error) {
        toast(result.error, 'error')
      }
    } finally {
      setOcrBusy(false)
    }
  }

  const triggerCamera = async () => {
    if (window.mindvault?.captureScreenshot) {
      try {
        const result = await window.mindvault.captureScreenshot()
        if (result && result.blob) {
          const file = new File([result.blob], result.name || 'screenshot.png', { type: result.mime || 'image/png' })
          await handleImageCapture(file)
        }
      } catch (e) {
        toast(`Screenshot failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    } else if (cameraInput.current) {
      cameraInput.current.click()
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
        {voice.listening && <p className="listening"><span className="pulse" /> Listening\u2026 {voice.interim && <i className="muted">{voice.interim}</i>}</p>}
        {voice.error && <p className="small danger-text">{voice.error}</p>}
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
          <input ref={cameraInput} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files && e.target.files[0]) handleImageCapture(e.target.files[0]); e.target.value = '' }} />
          <button className="btn" onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} /> Add files</button>
          <button className="btn" onClick={triggerCamera} disabled={ocrBusy}>
            <Icon name="camera" size={16} /> {ocrBusy ? 'Reading text…' : 'Image to text'}
          </button>
          {voice.supported && (
            <button className={`btn ${voice.listening ? 'rec' : ''}`} onClick={() => (voice.listening ? voice.stop() : voice.start())} aria-pressed={voice.listening}>
              <Icon name="sparkle" size={16} /> {voice.listening ? 'Stop' : 'Dictate'}
            </button>
          )}
          <span className="muted small hide-mobile">Ctrl+Enter to save</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || (!text.trim() && !files.length)} onClick={save}>
            {busy ? 'Saving\u2026' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
