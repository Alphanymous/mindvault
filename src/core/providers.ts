/** Presets and validation that make the Settings screens hard to get wrong. */

export interface AiPreset {
  id: string
  label: string
  baseUrl: string
  needsKey: boolean
  defaultChatModel: string
  defaultEmbeddingModel: string
  note: string
}

export const AI_PRESETS: AiPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, defaultChatModel: 'gpt-4o-mini', defaultEmbeddingModel: 'text-embedding-3-small', note: 'Needs an API key from platform.openai.com.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, defaultChatModel: 'openai/gpt-4o-mini', defaultEmbeddingModel: 'openai/text-embedding-3-small', note: 'One key for many models.' },
  { id: 'ollama', label: 'Ollama (this computer)', baseUrl: 'http://localhost:11434/v1', needsKey: false, defaultChatModel: 'llama3.2', defaultEmbeddingModel: 'nomic-embed-text', note: 'Free and private, runs on your PC. Works from the desktop app.' },
  { id: 'lmstudio', label: 'LM Studio (this computer)', baseUrl: 'http://localhost:1234/v1', needsKey: false, defaultChatModel: 'local-model', defaultEmbeddingModel: 'text-embedding-nomic-embed-text-v1.5', note: 'Start its local server first.' },
]

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '')

export const chatUrl = (base: string) => `${trimSlash(base)}/chat/completions`
export const embeddingsUrl = (base: string) => `${trimSlash(base)}/embeddings`

/** Recover the base URL from a full endpoint the user pasted earlier. */
export function baseFromEndpoint(endpoint: string): string {
  return trimSlash(endpoint).replace(/\/(chat\/completions|embeddings)$/, '')
}

export function presetForEndpoint(endpoint: string): AiPreset | undefined {
  const base = baseFromEndpoint(endpoint)
  return AI_PRESETS.find((p) => p.baseUrl === base)
}

/** Google OAuth client IDs look like 1234567890-abc123def.apps.googleusercontent.com */
export const CLIENT_ID_RE = /^\d{6,}-[a-z0-9_]{8,}\.apps\.googleusercontent\.com$/i

export type ClientIdCheck = { ok: true } | { ok: false; reason: string }

export function checkClientId(raw: string): ClientIdCheck {
  const id = raw.trim()
  if (!id) return { ok: false, reason: 'Paste the client ID from Google Cloud.' }
  if (/\s/.test(id)) return { ok: false, reason: 'A client ID has no spaces. Copy only the ID.' }
  if (/^GOCSPX-/i.test(id)) return { ok: false, reason: 'That looks like the client secret. You need the Client ID, which ends in .apps.googleusercontent.com.' }
  if (!id.endsWith('.apps.googleusercontent.com')) return { ok: false, reason: 'The Client ID ends in .apps.googleusercontent.com.' }
  if (!CLIENT_ID_RE.test(id)) return { ok: false, reason: 'That does not look like a full client ID. Copy it again from the Credentials page.' }
  return { ok: true }
}

export interface ClipProxyPreset {
  id: string
  label: string
  template: string
  note: string
}

export const CLIP_PROXY_PRESETS: ClipProxyPreset[] = [
  { id: 'allorigins', label: 'AllOrigins (public)', template: 'https://api.allorigins.win/raw?url={url}', note: 'A free public service. It sees every address you clip. Use only for non-private pages.' },
]

export type ClipRoute = 'desktop' | 'android' | 'direct' | 'proxy'

/** Human explanation of how this device downloads pages, shown in Settings. */
export function describeClipSetup(opts: { electron: boolean; native: boolean; proxy: string }): { route: ClipRoute; ready: boolean; text: string } {
  if (opts.electron) return { route: 'desktop', ready: true, text: 'The desktop app downloads pages itself, with no browser limits. Nothing to set up.' }
  if (opts.native) return { route: 'android', ready: true, text: 'The Android app downloads pages through the phone’s network stack, with no browser limits. Nothing to set up.' }
  if (opts.proxy.trim()) return { route: 'proxy', ready: true, text: 'Pages are fetched through your proxy because browsers block direct downloads from other sites.' }
  return { route: 'direct', ready: false, text: 'Browsers block downloading most pages directly (CORS). Pick a proxy below, or use the desktop or Android app. Until then a clipped link is saved without its text.' }
}

export interface TestResult {
  ok: boolean
  message: string
}

export const okResult = (message: string): TestResult => ({ ok: true, message })
export const failResult = (e: unknown, hint = ''): TestResult => ({ ok: false, message: `${e instanceof Error ? e.message : 'Failed'}${hint ? ` ${hint}` : ''}` })
