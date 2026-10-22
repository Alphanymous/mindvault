import { describe, expect, it } from 'vitest'
import { classify, detectType, extractKeywords, looksLikePrompt, refineWithLlm } from './classify'
import type { Item } from './types'

describe('detectType', () => {
  it('detects pdf by mime and extension', () => {
    expect(detectType({ content: '', mime: 'application/pdf' }).type).toBe('pdf')
    expect(detectType({ content: '', fileName: 'x.PDF' }).type).toBe('pdf')
  })
  it('detects web by url or bare link', () => {
    expect(detectType({ content: 'x', url: 'https://a.com' }).type).toBe('web')
    expect(detectType({ content: 'https://a.com/page' }).type).toBe('web')
  })
  it('detects prompts', () => {
    expect(detectType({ content: 'You are a senior editor. Rewrite the text below.' }).type).toBe('prompt')
    expect(detectType({ title: 'Code review prompt', content: 'check the diff' }).type).toBe('prompt')
    expect(detectType({ content: 'Translate {{text}} into {{language}}, your answer must be short.' }).type).toBe('prompt')
  })
  it('falls back to note and file', () => {
    expect(detectType({ content: 'Meeting notes for Tuesday' }).type).toBe('note')
    expect(detectType({ content: '', fileName: 'data.zip' }).type).toBe('file')
    expect(detectType({ content: 'x', fileName: 'a.md' }).type).toBe('note')
  })
  it('respects forced type', () => {
    expect(detectType({ content: 'You are x', forcedType: 'note' }).type).toBe('note')
  })
})

describe('looksLikePrompt', () => {
  it('does not flag normal prose', () => {
    expect(looksLikePrompt('Trip', 'We went to the beach and had lunch.')).toBe(false)
  })
})

describe('extractKeywords', () => {
  it('returns frequent non-stopwords', () => {
    const k = extractKeywords('graph graph graph database database the the the and notes notes once', 3)
    expect(k).toEqual(['graph', 'database', 'notes'])
  })
})

describe('classify', () => {
  it('puts programming content in Dev/Code with tags', () => {
    const s = classify({
      title: 'Fixing a TypeScript build',
      content: 'The compiler fails on this function. Update the typescript config, run npm and git commit. #build',
    })
    expect(s.folder).toBe('Dev/Code')
    expect(s.tags).toContain('build')
    expect(s.type).toBe('note')
    expect(s.confidence).toBeGreaterThan(0.4)
  })

  it('groups prompts under AI/Prompts', () => {
    const s = classify({ title: 'Summarizer', content: 'You are an expert summarizer. Summarize {{text}} in 3 bullets.' })
    expect(s.type).toBe('prompt')
    expect(s.folder).toBe('AI/Prompts')
    expect(s.tags).toContain('prompt')
  })

  it('tags web clips with their domain and defaults to Reading', () => {
    const s = classify({ title: 'Hello', content: 'short', url: 'https://www.example.com/post' })
    expect(s.type).toBe('web')
    expect(s.folder).toBe('Reading')
    expect(s.tags).toContain('example')
  })

  it('uses frontmatter folder and tags', () => {
    const s = classify({ content: '---\nfolder: Work/Acme\ntags: [client]\n---\nBody text' })
    expect(s.folder).toBe('Work/Acme')
    expect(s.tags).toContain('client')
    expect(s.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('learns from existing organized folders', () => {
    const existing: Item = {
      id: '1', type: 'note', title: 'x', content: '', folder: 'Garden', tags: ['tomato', 'compost'],
      status: 'organized', createdAt: 1, updatedAt: 1,
    }
    const s = classify(
      { title: 'Soil', content: 'tomato tomato compost compost soil soil bed bed' },
      { items: [existing] },
    )
    expect(s.folder).toBe('Garden')
  })

  it('classifies pdf files by name', () => {
    const s = classify({ fileName: 'invoice-march.pdf', content: 'invoice total revenue tax payment invoice tax', mime: 'application/pdf' })
    expect(s.type).toBe('pdf')
    expect(s.folder).toBe('Business/Finance')
  })
})

describe('refineWithLlm', () => {
  const base = { type: 'note' as const, folder: 'Notes', tags: ['a'], confidence: 0.3, reason: 'x' }
  it('returns base when endpoint missing', async () => {
    expect(await refineWithLlm(base, { content: 'x' }, [], { endpoint: '', model: '', apiKey: '' })).toBe(base)
  })
  it('applies the model answer', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"folder":"Cooking","tags":["Pasta"],"type":"note"}' } }] }))) as typeof fetch
    const r = await refineWithLlm(base, { content: 'x' }, ['Cooking'], { endpoint: 'http://x', model: 'm', apiKey: 'k' }, fake)
    expect(r.folder).toBe('Cooking')
    expect(r.tags).toEqual(['pasta'])
  })
  it('falls back on errors', async () => {
    const boom = (async () => {
      throw new Error('net')
    }) as typeof fetch
    expect(await refineWithLlm(base, { content: 'x' }, [], { endpoint: 'http://x', model: 'm', apiKey: 'k' }, boom)).toBe(base)
  })
})
