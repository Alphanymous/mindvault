/** Vim-style key sequences ("g i" = go to inbox) with a timeout between keys. Pure, so it is unit tested. */

export interface Sequencer<A extends string> {
  /** Feed one key press; returns the action when a sequence completes, otherwise null. */
  feed(key: string, now: number): A | null
}

export function createSequencer<A extends string>(map: Record<string, A>, timeoutMs = 900): Sequencer<A> {
  const prefixes = new Set<string>()
  for (const seq of Object.keys(map)) {
    const keys = seq.split(' ')
    for (let i = 1; i < keys.length; i++) prefixes.add(keys.slice(0, i).join(' '))
  }
  let buffer: string[] = []
  let last = 0
  return {
    feed(key, now) {
      if (now - last > timeoutMs) buffer = []
      last = now
      const attempt = [...buffer, key].join(' ')
      if (map[attempt]) {
        buffer = []
        return map[attempt]
      }
      if (prefixes.has(attempt)) {
        buffer = [...buffer, key]
        return null
      }
      // restart: the key might itself start or be a sequence
      buffer = []
      if (map[key]) return map[key]
      if (prefixes.has(key)) buffer = [key]
      return null
    },
  }
}

export type ShortcutAction =
  | 'home'
  | 'inbox'
  | 'library'
  | 'graph'
  | 'prompts'
  | 'settings'
  | 'newNote'
  | 'newPrompt'
  | 'capture'
  | 'search'
  | 'help'
  | 'back'

export const SHORTCUTS: Record<string, ShortcutAction> = {
  'g h': 'home',
  'g i': 'inbox',
  'g l': 'library',
  'g g': 'graph',
  'g p': 'prompts',
  'g s': 'settings',
  n: 'newNote',
  p: 'newPrompt',
  c: 'capture',
  '/': 'search',
  '?': 'help',
  b: 'back',
}

export const SHORTCUT_HELP: { keys: string; label: string }[] = [
  { keys: 'Ctrl K  or  /', label: 'Search and commands' },
  { keys: 'c', label: 'Capture a link, text or file' },
  { keys: 'n', label: 'New note' },
  { keys: 'p', label: 'New prompt' },
  { keys: 'g h', label: 'Go to Home' },
  { keys: 'g i', label: 'Go to Inbox' },
  { keys: 'g l', label: 'Go to Library' },
  { keys: 'g p', label: 'Go to Prompts' },
  { keys: 'g g', label: 'Go to Graph' },
  { keys: 'g s', label: 'Go to Settings' },
  { keys: 'b', label: 'Back to the previous page' },
  { keys: '?', label: 'Show this list' },
  { keys: '> in search', label: 'Commands' },
  { keys: '# in search', label: 'Browse a tag' },
  { keys: '@ in search', label: 'Browse a folder or collection' },
]
