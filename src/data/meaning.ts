/** Search index + optional embeddings, shared by the palette, the Related panel and Settings. */
import { useMemo } from 'react'
import { indexItems, embedTexts, nearestByVector, staleItems, type EmbeddingCache, type EmbeddingsConfig } from '../core/embeddings'
import { buildIndex, relatedTo, type SimilarityIndex } from '../core/similarity'
import { smartSearch, type SmartHit } from '../core/smartSearch'
import type { Item } from '../core/types'
import { metaDb } from './db'
import { getState, useAppState } from './store'

let cachedFor: Item[] | null = null
let cachedIndex: SimilarityIndex | null = null

/** One similarity index per version of the items array (it is replaced on every change). */
export function getIndex(items: Item[] = getState().items): SimilarityIndex {
  if (cachedFor !== items || !cachedIndex) {
    cachedIndex = buildIndex(items)
    cachedFor = items
  }
  return cachedIndex
}

export function useIndex(): SimilarityIndex {
  const { items } = useAppState()
  return useMemo(() => getIndex(items), [items])
}

export function useRelated(id: string, limit = 6): Item[] {
  const { items } = useAppState()
  return useMemo(() => {
    const byId = new Map(items.filter((i) => !i.deleted).map((i) => [i.id, i]))
    return relatedTo(getIndex(items), id, limit)
      .map((s) => byId.get(s.id))
      .filter((i): i is Item => !!i && i.status === 'organized')
  }, [items, id, limit])
}

export function embeddingsConfig(): EmbeddingsConfig | null {
  const s = getState().settings
  return s.embeddingsEndpoint ? { endpoint: s.embeddingsEndpoint, model: s.embeddingsModel, apiKey: s.llmApiKey } : null
}

let embeddingCache: EmbeddingCache | null = null
export async function loadEmbeddingCache(): Promise<EmbeddingCache> {
  embeddingCache ??= (await metaDb.get<EmbeddingCache>('embeddings')) ?? {}
  return embeddingCache
}

export async function indexEverything(onProgress: (done: number, total: number) => void): Promise<number> {
  const cfg = embeddingsConfig()
  if (!cfg) throw new Error('Add an embeddings endpoint first.')
  const next = await indexItems(getState().items, await loadEmbeddingCache(), cfg, onProgress)
  embeddingCache = next
  await metaDb.set('embeddings', next)
  return Object.keys(next).length
}

export async function embeddingStatus(): Promise<{ indexed: number; stale: number }> {
  const cache = await loadEmbeddingCache()
  const stale = staleItems(getState().items, cache).length
  return { indexed: Object.keys(cache).length, stale }
}

/** Meaning-based neighbours of a query, or [] when no endpoint / no index / the call fails. */
export async function meaningNeighbours(query: string): Promise<{ id: string; score: number }[]> {
  const cfg = embeddingsConfig()
  if (!cfg) return []
  const cache = await loadEmbeddingCache()
  if (Object.keys(cache).length === 0) return []
  try {
    const [vec] = await embedTexts(cfg, [query.slice(0, 2000)])
    return nearestByVector(cache, vec)
  } catch {
    return []
  }
}

export async function runSmartSearch(query: string, limit = 12): Promise<SmartHit[]> {
  const { items } = getState()
  const semantic = await meaningNeighbours(query)
  return smartSearch(items, query, getIndex(items), semantic, limit)
}
