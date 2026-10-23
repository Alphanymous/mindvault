import { describe, expect, it } from 'vitest'
import { buildIndex, bestPassage, relatedTo, similarToText, stem, termsOf } from './similarity'
import { smartSearch } from './smartSearch'
import { cosineDense, embedTexts, indexItems, nearestByVector, staleItems } from './embeddings'
import type { Item } from './types'

let n = 0
const mk = (title: string, content: string, tags: string[] = []): Item => ({
  id: `m${String(++n).padStart(5, '0')}`, type: 'note', title, content, folder: '', tags, status: 'organized', createdAt: 1, updatedAt: n,
})

const corpus = [
  mk('Pricing strategy', 'We should raise subscription prices. Revenue per customer matters for the quarterly budget.', ['pricing']),
  mk('Invoice template', 'Invoice with tax and payment terms for each customer. Accounting export.', ['finance']),
  mk('Sourdough bread', 'Flour, water, salt and a starter. Bake in a dutch oven, proof overnight.', ['recipe']),
  mk('Rust ownership', 'Borrowing and lifetimes in the Rust compiler. Ownership moves values.', ['rust']),
  mk('Trip to Lisbon', 'Flights, hotel and a tram tour of the old town.', ['travel']),
]

describe('stemming and terms', () => {
  it('merges plurals and verb forms', () => {
    expect(stem('prices')).toBe(stem('price'))
    expect(stem('compiling')).toBe(stem('compiled'))
    expect(stem('companies')).toBe(stem('company'))
    expect(stem('Ação')).toBe('acao')
  })
  it('adds concept terms from the topic dictionary', () => {
    expect(termsOf('invoice')).toContain('~Business/Finance')
    expect(termsOf('compiler')).toContain('~Dev/Code')
  })
})

describe('topical similarity', () => {
  const index = buildIndex(corpus)
  it('finds notes by concept even without the same word', () => {
    // "money" is not in any note; "revenue"/"invoice" are finance words
    const hits = similarToText(index, 'revenue and budget', 3).map((h) => corpus.find((c) => c.id === h.id)!.title)
    expect(hits[0]).toBe('Pricing strategy')
    expect(hits).toContain('Invoice template')
  })
  it('ranks related notes and excludes the note itself', () => {
    const rel = relatedTo(index, corpus[0].id, 3).map((h) => corpus.find((c) => c.id === h.id)!.title)
    expect(rel).toContain('Invoice template')
    expect(rel).not.toContain('Pricing strategy')
    expect(rel).not.toContain('Sourdough bread')
  })
  it('returns nothing for unrelated or empty queries', () => {
    expect(similarToText(index, 'the and of', 5)).toEqual([])
  })
})

describe('passages', () => {
  it('returns the window with the most matching words, highlighted', () => {
    const text = 'Intro text about nothing. '.repeat(20) + 'The borrowing rules of the compiler are strict about ownership. ' + 'Outro filler. '.repeat(20)
    const parts = bestPassage(text, 'ownership compiler')
    const hits = parts.filter((p) => p.hit).map((p) => p.text.trim())
    expect(hits).toEqual(expect.arrayContaining(['compiler', 'ownership.'.replace('.', '')].map((s) => expect.stringContaining(s.slice(0, 5)))))
    expect(parts.map((p) => p.text).join('')).toContain('borrowing rules')
    expect(parts[0].text.startsWith('…')).toBe(true)
  })
})

describe('smartSearch fusion', () => {
  const index = buildIndex(corpus)
  it('combines exact words and topic matches and labels why', () => {
    const hits = smartSearch(corpus, 'invoice payment', index)
    expect(hits[0].item.title).toBe('Invoice template')
    expect(hits[0].via).toContain('words')
    const topical = smartSearch(corpus, 'revenue', index).map((h) => h.item.title)
    expect(topical).toContain('Invoice template')
  })
  it('adds embedding neighbours labelled "meaning"', () => {
    const hits = smartSearch(corpus, 'zzzz', index, [{ id: corpus[4].id, score: 0.9 }])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ via: ['meaning'] })
  })
  it('ignores deleted items and empty queries', () => {
    expect(smartSearch(corpus, '  ', index)).toEqual([])
    const gone = [{ ...corpus[0], deleted: true }, ...corpus.slice(1)]
    expect(smartSearch(gone, 'pricing', buildIndex(gone)).some((h) => h.item.id === corpus[0].id)).toBe(false)
  })
})

describe('embeddings', () => {
  const fake = (async (_u: unknown, init: RequestInit) => {
    const input = JSON.parse(String(init.body)).input as string[]
    // vector = [contains "bread", contains "invoice"]
    const data = input.map((t, index) => ({ index, embedding: [/bread/i.test(t) ? 1 : 0, /invoice/i.test(t) ? 1 : 0] }))
    return new Response(JSON.stringify({ data }))
  }) as typeof fetch
  const cfg = { endpoint: 'http://x', model: 'm', apiKey: 'k' }

  it('embeds, caches, and only re-embeds changed items', async () => {
    const progress: number[] = []
    let cache = await indexItems(corpus, {}, cfg, (d) => progress.push(d), fake)
    expect(Object.keys(cache)).toHaveLength(5)
    expect(progress.at(-1)).toBe(5)
    expect(staleItems(corpus, cache)).toHaveLength(0)
    const edited = corpus.map((c, i) => (i === 1 ? { ...c, updatedAt: 999 } : c))
    expect(staleItems(edited, cache).map((i) => i.title)).toEqual(['Invoice template'])
    cache = await indexItems(edited, cache, cfg, () => {}, fake)
    expect(cache[corpus[1].id].u).toBe(999)
  })
  it('finds nearest vectors and rejects malformed responses', async () => {
    const cache = await indexItems(corpus, {}, cfg, () => {}, fake)
    const [q] = await embedTexts(cfg, ['I want bread'], fake)
    expect(nearestByVector(cache, q)[0].id).toBe(corpus[2].id)
    expect(cosineDense([1, 0], [0, 1])).toBe(0)
    const broken = (async () => new Response(JSON.stringify({ data: [] }))) as typeof fetch
    await expect(embedTexts(cfg, ['a'], broken)).rejects.toThrow('Unexpected')
    const down = (async () => new Response('x', { status: 500 })) as typeof fetch
    await expect(embedTexts(cfg, ['a'], down)).rejects.toThrow('500')
  })
})
