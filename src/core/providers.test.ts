import { describe, expect, it } from 'vitest'
import { AI_PRESETS, baseFromEndpoint, checkClientId, chatUrl, describeClipSetup, embeddingsUrl, presetForEndpoint } from './providers'

describe('Google client ID check', () => {
  it('accepts a real-looking ID', () => {
    expect(checkClientId(' 123456789012-abc123def456ghi789.apps.googleusercontent.com ')).toEqual({ ok: true })
  })
  it.each([
    ['', 'Paste'],
    ['123 456.apps.googleusercontent.com', 'spaces'],
    ['GOCSPX-abcdefghijklmnop', 'secret'],
    ['1234567-abc', 'ends in'],
    ['x-y.apps.googleusercontent.com', 'full client ID'],
  ])('rejects %j with a helpful reason', (input, word) => {
    const r = checkClientId(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(word)
  })
})

describe('AI endpoints', () => {
  it('builds and parses endpoint URLs', () => {
    expect(chatUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions')
    expect(embeddingsUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/embeddings')
    expect(baseFromEndpoint('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1')
    expect(baseFromEndpoint('https://x.test/v1/embeddings/')).toBe('https://x.test/v1')
  })
  it('recognises presets from pasted endpoints and keeps local ones key-free', () => {
    expect(presetForEndpoint('https://openrouter.ai/api/v1/chat/completions')?.id).toBe('openrouter')
    expect(presetForEndpoint('https://unknown.test/v1/chat/completions')).toBeUndefined()
    expect(AI_PRESETS.filter((p) => !p.needsKey).map((p) => p.id)).toEqual(['ollama', 'lmstudio'])
  })
})

describe('clip setup explanation', () => {
  it('is ready on desktop and Android, needs a proxy in a browser', () => {
    expect(describeClipSetup({ electron: true, native: false, proxy: '' })).toMatchObject({ route: 'desktop', ready: true })
    expect(describeClipSetup({ electron: false, native: true, proxy: '' })).toMatchObject({ route: 'android', ready: true })
    expect(describeClipSetup({ electron: false, native: false, proxy: '' })).toMatchObject({ route: 'direct', ready: false })
    expect(describeClipSetup({ electron: false, native: false, proxy: 'https://p/?u={url}' })).toMatchObject({ route: 'proxy', ready: true })
  })
})
