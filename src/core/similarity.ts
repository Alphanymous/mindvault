/**
 * On-device topical similarity with no model download: stemmed TF-IDF plus "concept" terms taken from the
 * classifier's topic dictionary, so "invoice" and "revenue" land near each other even without a shared word.
 * For true meaning matching, the optional embeddings endpoint (core/embeddings.ts) is fused on top.
 */
import { STOPWORDS, TOPICS } from './classify'
import type { Item } from './types'

const stripAccents = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Small suffix stemmer: enough to merge plurals and verb forms. */
export function stem(word: string): string {
  let w = stripAccents(word.toLowerCase())
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  for (const suf of ['ingly', 'edly', 'ing', 'ers', 'er', 'ed', 'es', 'ly', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length)
      break
    }
  }
  if (/(.)\1$/.test(w) && w.length > 3) w = w.slice(0, -1)
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1)
  return w
}

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of stripAccents(text.toLowerCase()).match(/[a-z0-9][a-z0-9'-]*/g) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue
    out.push(stem(raw))
  }
  return out
}

// stem -> topic names, built once
const CONCEPTS = new Map<string, string[]>()
for (const [topic, kws] of Object.entries(TOPICS)) {
  for (const kw of kws) {
    for (const part of kw.split(/\s+/)) {
      const s = stem(part)
      const list = CONCEPTS.get(s) ?? []
      if (!list.includes(topic)) list.push(topic)
      CONCEPTS.set(s, list)
    }
  }
}

/** Terms for one text: its stems plus a concept term for each topic the stems belong to. */
export function termsOf(text: string): string[] {
  const stems = tokenize(text)
  const out = [...stems]
  for (const s of stems) for (const topic of CONCEPTS.get(s) ?? []) out.push(`~${topic}`)
  return out
}

type Vec = Map<string, number>

export interface SimilarityIndex {
  vectors: Map<string, Vec>
  norms: Map<string, number>
  idf: Map<string, number>
}

function docText(item: Item): string {
  return `${item.title} ${item.title} ${item.title} ${item.tags.join(' ')} ${item.tags.join(' ')} ${item.content.slice(0, 20000)}`
}

function weigh(terms: string[], idf: Map<string, number>): { vec: Vec; norm: number } {
  const counts = new Map<string, number>()
  for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1)
  const vec: Vec = new Map()
  let sq = 0
  for (const [t, c] of counts) {
    const w = (1 + Math.log(c)) * (idf.get(t) ?? 1)
    vec.set(t, w)
    sq += w * w
  }
  return { vec, norm: Math.sqrt(sq) || 1 }
}

export function buildIndex(items: Item[]): SimilarityIndex {
  const live = items.filter((i) => !i.deleted)
  const docs = live.map((i) => ({ id: i.id, terms: termsOf(docText(i)) }))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = Math.max(docs.length, 1)
  const idf = new Map<string, number>()
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / c))
  const vectors = new Map<string, Vec>()
  const norms = new Map<string, number>()
  for (const d of docs) {
    const { vec, norm } = weigh(d.terms, idf)
    vectors.set(d.id, vec)
    norms.set(d.id, norm)
  }
  return { vectors, norms, idf }
}

function cosine(a: Vec, an: number, b: Vec, bn: number): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [t, w] of small) {
    const o = large.get(t)
    if (o) dot += w * o
  }
  return dot / (an * bn)
}

export interface Scored {
  id: string
  score: number
}

/** Documents most similar to a free-text query. */
export function similarToText(index: SimilarityIndex, text: string, limit = 20): Scored[] {
  const { vec, norm } = weigh(termsOf(text), index.idf)
  if (vec.size === 0) return []
  const out: Scored[] = []
  for (const [id, v] of index.vectors) {
    const s = cosine(vec, norm, v, index.norms.get(id)!)
    if (s > 0.05) out.push({ id, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Documents most similar to another document. */
export function relatedTo(index: SimilarityIndex, id: string, limit = 6): Scored[] {
  const base = index.vectors.get(id)
  if (!base) return []
  const bn = index.norms.get(id)!
  const out: Scored[] = []
  for (const [other, v] of index.vectors) {
    if (other === id) continue
    const s = cosine(base, bn, v, index.norms.get(other)!)
    if (s > 0.12) out.push({ id: other, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export interface PassagePart {
  text: string
  hit: boolean
}

/** The ~200 character window that contains the most query stems, split into highlight parts. */
export function bestPassage(content: string, query: string, width = 200): PassagePart[] {
  const plain = content.replace(/\s+/g, ' ').trim()
  const wanted = new Set(tokenize(query))
  if (!plain || wanted.size === 0) return [{ text: plain.slice(0, width), hit: false }]
  const words = [...plain.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, hit: wanted.has(stem(m[0].replace(/[^\p{L}\p{N}'-]/gu, ''))) }))
  let best = { from: 0, score: -1 }
  let lo = 0
  let score = 0
  for (let hi = 0; hi < words.length; hi++) {
    if (words[hi].hit) score++
    while (words[hi].end - words[lo].start > width) {
      if (words[lo].hit) score--
      lo++
    }
    if (score > best.score) best = { from: lo, score }
  }
  const slice = words.filter((w, i) => i >= best.from && w.end - words[best.from].start <= width)
  if (!slice.length) return [{ text: plain.slice(0, width), hit: false }]
  const parts: PassagePart[] = []
  if (words[best.from].start > 0) parts.push({ text: '… ', hit: false })
  slice.forEach((w, i) => {
    parts.push({ text: plain.slice(w.start, w.end) + (i < slice.length - 1 ? ' ' : ''), hit: w.hit })
  })
  const last = slice[slice.length - 1]
  if (last.end < plain.length) parts.push({ text: ' …', hit: false })
  // merge neighbours with the same flag
  return parts.reduce<PassagePart[]>((acc, p) => {
    const prev = acc[acc.length - 1]
    if (prev && prev.hit === p.hit) prev.text += p.text
    else acc.push({ ...p })
    return acc
  }, [])
}
