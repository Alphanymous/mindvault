import { useEffect, useRef, useState } from 'react'
import type { Item } from '../../core/types'
import { itemsDb } from '../../data/db'
import { sampleItems } from '../../data/sample'
import { liveItems, replaceItemsFromSync, useAppState } from '../../data/store'
import { Icon } from '../Icon'
import { toast } from '../toast'
import { formatBytes } from '../util'
import { Section } from './parts'

export function DataTab() {
  const { items } = useAppState()
  const live = items.filter((i) => !i.deleted)
  const importRef = useRef<HTMLInputElement>(null)
  const [usage, setUsage] = useState<{ used?: number; quota?: number }>({})
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage, quota: e.quota }))
  }, [items.length])

  const counts = (['note', 'pdf', 'web', 'prompt', 'file'] as const).map((t) => [t, live.filter((i) => i.type === t).length] as const)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ version: 1, items: liveItems() }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mindvault-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const importJson = async (file?: File) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as { items?: Item[] }
      if (!Array.isArray(data.items)) throw new Error('That file is not a Mindvault backup.')
      await replaceItemsFromSync(data.items.filter((i) => i && i.id && i.title !== undefined))
      toast(`Imported ${data.items.length} items`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', 'error')
    }
  }

  const wipe = async () => {
    const typed = prompt('This deletes every note, PDF and setting stored on THIS device (cloud and paired copies are not touched).\n\nType DELETE to confirm.')
    if (typed?.trim() !== 'DELETE') return
    await itemsDb.clear()
    localStorage.clear()
    location.reload()
  }

  return (
    <>
      <Section icon="library" title="Your vault">
        <p className="muted">
          {live.length} items on this device: {counts.filter(([, n]) => n).map(([t, n]) => `${n} ${t}${n === 1 ? '' : 's'}`).join(', ') || 'nothing yet'}.
          {usage.used ? ` Using ${formatBytes(usage.used)}${usage.quota ? ` of ${formatBytes(usage.quota)} available` : ''}.` : ''}
        </p>
      </Section>

      <Section icon="download" title="Backup and restore">
        <p className="muted">A backup holds your notes, prompts, links and extracted PDF text. PDF original files are kept by sync, not in this file.</p>
        <div className="row">
          <button className="btn" onClick={exportJson}><Icon name="download" size={16} /> Export backup</button>
          <button className="btn" onClick={() => importRef.current?.click()}><Icon name="upload" size={16} /> Import backup</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </Section>

      <Section icon="sparkle" title="Try it out">
        <p className="muted">Adds a small connected set of notes, prompts and a web clip so you can see the graph, search and prompt shelf working.</p>
        <div className="row">
          <button className="btn" onClick={async () => { await replaceItemsFromSync(sampleItems()); toast('Sample notes added') }}>Add sample notes</button>
        </div>
      </Section>

      <Section icon="trash" title="Danger zone">
        <p className="muted">Wipes this device only. Use it before handing the device to someone else.</p>
        <div className="row"><button className="btn danger-btn" onClick={() => void wipe()}>Delete everything on this device…</button></div>
      </Section>
    </>
  )
}
