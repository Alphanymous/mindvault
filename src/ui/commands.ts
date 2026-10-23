import { acceptAllInbox, createItem, saveSettings, getState } from '../data/store'
import type { ShortcutAction } from '../core/keys'
import { go } from './router'
import { toast } from './toast'

/** What the app shell lets commands and shortcuts do. */
export interface AppActions {
  openCapture(opts?: { text?: string; dictate?: boolean }): void
  openSearch(initial?: string): void
  openHelp(): void
}

export interface Command {
  id: string
  label: string
  icon: string
  /** Shown on the right, e.g. the keyboard shortcut. */
  hint?: string
  /** Extra words that should match. */
  keywords?: string
  run(): void
}

export async function newNote() {
  const it = await createItem({ title: 'Untitled note', content: '', organized: true, type: 'note' })
  go({ name: 'item', id: it.id })
}

export async function newPrompt() {
  const it = await createItem({
    type: 'prompt',
    title: 'New prompt',
    content: 'You are a helpful assistant.\n\nTask: {{task}}\n',
    organized: true,
    folder: 'AI/Prompts',
    tags: ['prompt'],
  })
  go({ name: 'item', id: it.id })
}

export function runShortcut(action: ShortcutAction, a: AppActions) {
  switch (action) {
    case 'home': return go({ name: 'home' })
    case 'inbox': return go({ name: 'inbox' })
    case 'library': return go({ name: 'library' })
    case 'graph': return go({ name: 'graph' })
    case 'prompts': return go({ name: 'prompts' })
    case 'settings': return go({ name: 'settings' })
    case 'newNote': return void newNote()
    case 'newPrompt': return void newPrompt()
    case 'capture': return a.openCapture()
    case 'search': return a.openSearch()
    case 'help': return a.openHelp()
    case 'back': return history.back()
  }
}

export function makeCommands(a: AppActions): Command[] {
  const nav = (id: string, label: string, icon: string, action: ShortcutAction, hint?: string, keywords = ''): Command => ({
    id, label, icon, hint, keywords, run: () => runShortcut(action, a),
  })
  return [
    { id: 'capture', label: 'Capture a link, text or file', icon: 'plus', hint: 'c', keywords: 'add save clip import', run: () => a.openCapture() },
    { id: 'dictate', label: 'Dictate a note (voice)', icon: 'sparkle', keywords: 'voice speak microphone record', run: () => a.openCapture({ dictate: true }) },
    nav('new-note', 'New note', 'edit', 'newNote', 'n', 'write create'),
    nav('new-prompt', 'New prompt', 'prompt', 'newPrompt', 'p', 'ai template create'),
    nav('home', 'Go to Home', 'graph', 'home', 'g h', 'dashboard start'),
    nav('inbox', 'Go to Inbox', 'inbox', 'inbox', 'g i', 'review file'),
    nav('library', 'Go to Library', 'library', 'library', 'g l', 'all items browse'),
    nav('prompts', 'Go to Prompts', 'prompt', 'prompts', 'g p', 'toolbox'),
    nav('graph', 'Open the Graph', 'graph', 'graph', 'g g', 'map network'),
    nav('settings', 'Settings & sync', 'settings', 'settings', 'g s', 'preferences pairing drive'),
    nav('back', 'Go back', 'back', 'back', 'b', 'previous history jump'),
    {
      id: 'accept-all',
      label: 'Accept everything in the inbox',
      icon: 'check',
      keywords: 'file organise',
      run: async () => toast(`Filed ${await acceptAllInbox()} items`),
    },
    {
      id: 'theme',
      label: 'Switch theme (dark / light)',
      icon: 'eye',
      keywords: 'appearance color dark light',
      run: () => void saveSettings({ theme: getState().settings.theme === 'light' ? 'dark' : 'light' }),
    },
    { id: 'help', label: 'Keyboard shortcuts', icon: 'search', hint: '?', keywords: 'keys help', run: () => a.openHelp() },
  ]
}

/** Substring match on label and keywords; every typed word must appear. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return commands
  return commands.filter((c) => {
    const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
