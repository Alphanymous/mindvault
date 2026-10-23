/** Optional meaning-based search through any OpenAI-compatible /embeddings endpoint. Cached on this device only. */
import type { Item } from './types'

export interface EmbeddingsConfig {
  endpoint: string
  model: string
  apiKey: string
}

export type EmbeddingCache = Record<string, { u: number; v: number[] }>

const BATCH = 16
const MAX_CHARS = 6000

export function embeddingText(item: Item): string {
  return `${item.title}\n${item.tags.join(' ')}\n${item.content}`.slice(0, MAX_CHARS)
}

export function cosineDense(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export async function embedTexts(cfg: EmbeddingsConfig, texts: string[], fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  const res = await fetchImpl(cfg.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Embeddings endpoint answered ${res.status}`)
  const json = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding))) throw new Error('Unexpected embeddings response')
  return data.map((d) => d.embedding!.map((x) => Math.round(x * 1e4) / 1e4))
}

/** Items whose cached vector is missing or older than the item. */
export function staleItems(items: Item[], cache: EmbeddingCache): Item[] {
  return items.filter((i) => !i.deleted && i.status === 'organized' && cache[i.id]?.u !== i.updatedAt)
}

/** Embed everything stale, in batches. Reports progress and returns the new cache without mutating the old. */
export async function indexItems(
  items: Item[],
  cache: EmbeddingCache,
  cfg: EmbeddingsConfig,
  onProgress: (done: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddingCache> {
  const todo = staleItems(items, cache)
  const next: EmbeddingCache = {}
  const live = new Set(items.filter((i) => !i.deleted).map((i) => i.id))
  for (const [id, e] of Object.entries(cache)) if (live.has(id)) next[id] = e
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    const vecs = await embedTexts(cfg, chunk.map(embeddingText), fetchImpl)
    chunk.forEach((it, k) => {
      next[it.id] = { u: it.updatedAt, v: vecs[k] }
    })
    onProgress(Math.min(i + BATCH, todo.length), todo.length)
  }
  return next
}

export function nearestByVector(cache: EmbeddingCache, query: number[], limit = 20): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = []
  for (const [id, e] of Object.entries(cache)) {
    const s = cosineDense(query, e.v)
    if (s > 0.2) out.push({ id, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
