/** Per-device usage memory: what you opened, which prompts you copy, answers you typed. Never synced. */
import type { Collection } from './collections'

export interface PromptStat {
  count: number
  last: number
  models: Record<string, number>
}

export interface Usage {
  /** Item ids, most recently opened first. */
  recent: string[]
  /** Every item id opened at least once ("read"). */
  seen: string[]
  prompts: Record<string, PromptStat>
  /** Last value typed for each {{variable}} name, shared across prompts. */
  vars: Record<string, string>
  collections: Collection[]
}

export const EMPTY_USAGE: Usage = { recent: [], seen: [], prompts: {}, vars: {}, collections: [] }

const MAX_RECENT = 40
const MAX_SEEN = 5000
const MAX_VARS = 100

export function normalizeUsage(raw: unknown): Usage {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Usage>
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [])
  return {
    recent: strs(r.recent).slice(0, MAX_RECENT),
    seen: strs(r.seen).slice(-MAX_SEEN),
    prompts: r.prompts && typeof r.prompts === 'object' ? (r.prompts as Usage['prompts']) : {},
    vars: r.vars && typeof r.vars === 'object' ? (r.vars as Usage['vars']) : {},
    collections: Array.isArray(r.collections) ? (r.collections as Collection[]) : [],
  }
}

export function openItem(u: Usage, id: string): Usage {
  return {
    ...u,
    recent: [id, ...u.recent.filter((x) => x !== id)].slice(0, MAX_RECENT),
    seen: u.seen.includes(id) ? u.seen : [...u.seen, id].slice(-MAX_SEEN),
  }
}

export function usePrompt(u: Usage, id: string, model: string | undefined, now: number): Usage {
  const prev = u.prompts[id] ?? { count: 0, last: 0, models: {} }
  const models = { ...prev.models }
  if (model) models[model] = (models[model] ?? 0) + 1
  return { ...u, prompts: { ...u.prompts, [id]: { count: prev.count + 1, last: now, models } } }
}

/** Remember non-empty answers; keeps only the most recent MAX_VARS names. */
export function rememberVars(u: Usage, values: Record<string, string>): Usage {
  const merged = { ...u.vars }
  for (const [k, v] of Object.entries(values)) {
    if (!v) continue
    delete merged[k]
    merged[k] = v
  }
  const keys = Object.keys(merged)
  const trimmed = keys.length > MAX_VARS ? Object.fromEntries(keys.slice(-MAX_VARS).map((k) => [k, merged[k]])) : merged
  return { ...u, vars: trimmed }
}

export function addCollection(u: Usage, c: Collection): Usage {
  return { ...u, collections: [...u.collections.filter((x) => x.id !== c.id), c] }
}

export function removeCollection(u: Usage, id: string): Usage {
  return { ...u, collections: u.collections.filter((x) => x.id !== id) }
}

export function topModels(stat: PromptStat | undefined, limit = 3): [string, number][] {
  return Object.entries(stat?.models ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}
