import { useEffect, useState } from 'react'
import { AI_PRESETS, baseFromEndpoint, chatUrl, embeddingsUrl, presetForEndpoint } from '../../core/providers'
import { testChat, testEmbeddings } from '../../data/connections'
import { embeddingStatus, indexEverything } from '../../data/meaning'
import { saveSettings, useAppState } from '../../data/store'
import { Icon } from '../Icon'
import { toast } from '../toast'
import { Section, SecretInput, Status, TestButton } from './parts'

export function AiTab() {
  const { settings } = useAppState()
  const preset = presetForEndpoint(settings.llmEndpoint)
  const base = baseFromEndpoint(settings.llmEndpoint)
  const [customBase, setCustomBase] = useState(preset ? '' : base)
  const [mode, setMode] = useState<string>(!settings.llmEndpoint ? 'off' : (preset?.id ?? 'custom'))
  const [index, setIndex] = useState({ indexed: 0, stale: 0 })
  const [progress, setProgress] = useState('')
  useEffect(() => {
    void embeddingStatus().then(setIndex)
  }, [settings.embeddingsEndpoint])

  const connected = !!settings.llmEndpoint
  const needsKey = mode !== 'off' && (preset ? preset.needsKey : true)

  const apply = async (id: string, baseUrl: string) => {
    setMode(id)
    if (id === 'off' || !baseUrl) {
      await saveSettings({ llmEndpoint: '', embeddingsEndpoint: '' })
      return
    }
    const p = AI_PRESETS.find((x) => x.id === id)
    await saveSettings({
      llmEndpoint: chatUrl(baseUrl),
      embeddingsEndpoint: embeddingsUrl(baseUrl),
      ...(p ? { llmModel: p.defaultChatModel, embeddingsModel: p.defaultEmbeddingModel } : {}),
    })
  }

  const build = async () => {
    setProgress('Starting…')
    try {
      const n = await indexEverything((done, total) => setProgress(`Indexing ${done} of ${total}…`))
      toast(`Meaning search ready: ${n} items indexed`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Indexing failed', 'error')
    } finally {
      setProgress('')
      setIndex(await embeddingStatus())
    }
  }

  return (
    <>
      <Section icon="sparkle" title="AI connection" status={<Status kind={connected ? 'ok' : 'off'}>{connected ? (preset?.label ?? 'Custom service') : 'Off'}</Status>}>
        <p className="muted">
          Optional. Mindvault sorts and searches fine without it. Connect any OpenAI-compatible service to get smarter folder suggestions, search by <i>meaning</i>, and a
          &ldquo;Run it now&rdquo; button on prompts. One connection powers all three.
        </p>

        <div className="chips-row" role="radiogroup" aria-label="AI service">
          <button className={`pill ${mode === 'off' ? 'on' : ''}`} onClick={() => void apply('off', '')}>Off</button>
          {AI_PRESETS.map((p) => (
            <button key={p.id} className={`pill ${mode === p.id ? 'on' : ''}`} onClick={() => void apply(p.id, p.baseUrl)}>{p.label}</button>
          ))}
          <button className={`pill ${mode === 'custom' ? 'on' : ''}`} onClick={() => setMode('custom')}>Other…</button>
        </div>
        {preset && <p className="hint">{preset.note}</p>}

        {mode === 'custom' && (
          <label className="field">
            <span>Service address (ends in /v1)</span>
            <input
              value={customBase}
              onChange={(e) => setCustomBase(e.target.value)}
              onBlur={() => void apply('custom', customBase)}
              placeholder="https://my-service.example/v1"
              spellCheck={false}
            />
          </label>
        )}

        {mode !== 'off' && (
          <>
            {needsKey && <SecretInput label="API key" value={settings.llmApiKey} onChange={(v) => saveSettings({ llmApiKey: v })} placeholder="sk-…" />}
            <div className="inline-fields">
              <label className="field">
                <span>Chat model</span>
                <input value={settings.llmModel} onChange={(e) => saveSettings({ llmModel: e.target.value })} spellCheck={false} />
              </label>
              <label className="field">
                <span>Meaning-search model</span>
                <input value={settings.embeddingsModel} onChange={(e) => saveSettings({ embeddingsModel: e.target.value })} spellCheck={false} />
              </label>
            </div>
            <div className="row">
              <TestButton primary label="Test chat" run={testChat} />
              <TestButton label="Test meaning search" run={testEmbeddings} />
            </div>
            <p className="muted small">
              What is sent: the first 3000 characters of each new item (sorting), the text of your notes once (indexing), the words you search (meaning search), and a prompt when you press
              Run. Your key stays on this device. Local services such as Ollama never leave your computer.
            </p>
          </>
        )}
      </Section>

      <Section icon="search" title="Meaning search" status={<Status kind={connected && index.indexed ? 'ok' : connected ? 'warn' : 'off'}>{connected ? `${index.indexed} indexed${index.stale ? `, ${index.stale} to update` : ''}` : 'Needs AI connection'}</Status>}>
        <p className="muted">
          Search already understands word forms and topics on this device. With an AI connection it also matches <i>meaning</i>: &ldquo;that article about getting paid&rdquo; finds your
          invoice notes. Build the index once; it updates when notes change.
        </p>
        <div className="row">
          <button className="btn primary" disabled={!connected || !!progress} onClick={() => void build()}>
            <Icon name="refresh" size={16} /> {progress || (index.indexed ? 'Update index' : 'Build index')}
          </button>
        </div>
      </Section>
    </>
  )
}
