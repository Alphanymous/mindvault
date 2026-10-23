import { useMemo, useState } from 'react'
import { parseFrontmatter } from '../core/markdown'
import { runPrompt, MODEL_LABELS } from '../core/promptRun'
import { fillPrompt, promptBody, promptVariables } from '../core/prompts'
import { topModels } from '../core/usage'
import type { Item } from '../core/types'
import { createItem, getState, updateItem, useAppState } from '../data/store'
import { getUsage, recordPromptUse, saveVars, useUsage } from '../data/usage'
import { Icon } from './Icon'
import { go, href } from './router'
import { toast } from './toast'
import { copyText } from './util'

/** Everything you do with a prompt: fill variables (remembered), copy for a model, run it, share it, make variants. */
export function PromptToolbox({ item, content }: { item: Item; content: string }) {
  const { items, settings } = useAppState()
  const usage = useUsage()
  const body = promptBody(content)
  const vars = useMemo(() => promptVariables(body), [body])
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v, getUsage().vars[v] ?? ''])))
  const stat = usage.prompts[item.id]
  const [model, setModel] = useState<string>(() => topModels(stat, 1)[0]?.[0] ?? MODEL_LABELS[0])
  const [answer, setAnswer] = useState('')
  const [running, setRunning] = useState(false)
  const filled = fillPrompt(body, values)
  const missing = vars.filter((v) => !values[v])

  const fm = parseFrontmatter(content).data
  const parentTitle = typeof fm.variant_of === 'string' ? fm.variant_of : ''
  const parent = parentTitle ? items.find((i) => !i.deleted && i.type === 'prompt' && i.title === parentTitle) : undefined
  const variants = items.filter((i) => !i.deleted && i.type === 'prompt' && i.id !== item.id && parseFrontmatter(i.content).data.variant_of === item.title)

  const copy = async () => {
    const ok = await copyText(filled)
    if (!ok) return toast('Copy failed', 'error')
    saveVars(values)
    recordPromptUse(item.id, model)
    toast(`Copied for ${model}`)
  }

  const run = async () => {
    setRunning(true)
    setAnswer('')
    try {
      const s = getState().settings
      setAnswer(await runPrompt({ endpoint: s.llmEndpoint, model: s.llmModel, apiKey: s.llmApiKey }, filled))
      saveVars(values)
      recordPromptUse(item.id, 'API')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Run failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: item.title, text: filled })
      recordPromptUse(item.id, 'Shared')
    } catch {
      /* cancelled */
    }
  }

  const makeVariant = async () => {
    const title = `${item.title} (variant)`
    const v = await createItem({
      type: 'prompt',
      title,
      content: `---\nvariant_of: ${item.title}\n---\n${body}`,
      organized: true,
      folder: item.folder,
      tags: [...new Set([...item.tags, 'variant'])],
    })
    toast('Variant created. Edit it to change the wording.')
    go({ name: 'item', id: v.id })
  }

  return (
    <div className="prompt-card">
      {vars.length > 0 && (
        <div className="vars">
          {vars.map((v) => (
            <label key={v}>
              <span>{v}</span>
              <input value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value })} placeholder={`{{${v}}}`} />
            </label>
          ))}
        </div>
      )}
      <pre className="prompt-text">{filled}</pre>

      <div className="model-pick" role="group" aria-label="Copy for">
        <span className="muted small">Copy for</span>
        {MODEL_LABELS.map((m) => (
          <button key={m} className={`pill ${model === m ? 'on' : ''}`} onClick={() => setModel(m)}>{m}</button>
        ))}
      </div>
      <button className="btn primary big" onClick={() => void copy()}>
        <Icon name="copy" size={18} /> {missing.length ? `Copy (${missing.length} blank)` : 'Copy prompt'}
      </button>

      <div className="row">
        {settings.llmEndpoint && (
          <button className="btn" disabled={running} onClick={() => void run()}><Icon name="sparkle" size={16} /> {running ? 'Running…' : 'Run it now'}</button>
        )}
        {typeof navigator.share === 'function' && <button className="btn" onClick={() => void share()}><Icon name="upload" size={16} /> Share…</button>}
        <button className="btn" onClick={() => void makeVariant()}><Icon name="plus" size={16} /> New variant</button>
        <button className="btn ghost" onClick={() => updateItem(item.id, { pinned: !item.pinned })}>
          <Icon name="sparkle" size={16} /> {item.pinned ? 'Favorite' : 'Add to favorites'}
        </button>
      </div>

      {stat && (
        <p className="muted small">
          Used {stat.count}×{topModels(stat).length ? ' · ' + topModels(stat).map(([m, n]) => `${m} ×${n}`).join(', ') : ''}
        </p>
      )}
      {answer && (
        <div className="answer">
          <div className="row">
            <b>Response</b>
            <span className="spacer" />
            <button className="btn" onClick={async () => toast((await copyText(answer)) ? 'Response copied' : 'Copy failed')}><Icon name="copy" size={15} /> Copy</button>
          </div>
          <pre className="prompt-text">{answer}</pre>
        </div>
      )}
      {(parent || variants.length > 0) && (
        <div className="variants">
          {parent && <a href={href({ name: 'item', id: parent.id })}>Variant of <b>{parent.title}</b></a>}
          {variants.length > 0 && <span className="muted small">Variants:</span>}
          {variants.map((v) => <a key={v.id} className="chip" href={href({ name: 'item', id: v.id })}>{v.title}</a>)}
        </div>
      )}
    </div>
  )
}
