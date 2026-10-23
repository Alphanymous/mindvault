import { useSyncExternalStore } from 'react'
import { BUILTIN_COLLECTIONS, type Collection } from '../core/collections'
import { EMPTY_USAGE, addCollection, normalizeUsage, openItem, rememberVars, removeCollection, usePrompt, type Usage } from '../core/usage'

const KEY = 'mv.usage'
const listeners = new Set<() => void>()

function read(): Usage {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalizeUsage(JSON.parse(raw)) : EMPTY_USAGE
  } catch {
    return EMPTY_USAGE
  }
}

let state: Usage = read()

function commit(next: Usage) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: usage lives in memory for this session */
  }
  listeners.forEach((l) => l())
}

export const getUsage = () => state
export function useUsage(): Usage {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export const markOpened = (id: string) => {
  if (state.recent[0] !== id || !state.seen.includes(id)) commit(openItem(state, id))
}
export const recordPromptUse = (id: string, model?: string) => commit(usePrompt(state, id, model, Date.now()))
export const saveVars = (values: Record<string, string>) => commit(rememberVars(state, values))
export const saveCollection = (c: Collection) => commit(addCollection(state, c))
export const deleteCollection = (id: string) => commit(removeCollection(state, id))

/** Built-in collections followed by the user's own. */
export function allCollections(u: Usage = state): Collection[] {
  return [...BUILTIN_COLLECTIONS, ...u.collections]
}
