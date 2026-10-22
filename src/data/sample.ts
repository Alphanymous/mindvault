import { classify } from '../core/classify'
import type { Item } from '../core/types'
import { newId } from './store'

interface Seed {
  title: string
  content: string
  folder: string
  tags: string[]
  type?: Item['type']
  url?: string
}

const SEEDS: Seed[] = [
  {
    title: 'Welcome to Mindvault',
    folder: 'Start here',
    tags: ['guide'],
    content:
      '# Welcome to Mindvault\n\nEverything you save lands in the **Inbox** with a suggested folder and tags. Accept it in one click.\n\n- Link notes like [[Zettelkasten method]] and [[Knowledge graph]]\n- Keep reusable [[Meeting summary prompt]] items one click from the clipboard\n- Clip articles: see [[Why local-first software]]\n\nOpen the **Graph** to watch your notes connect. #guide',
  },
  {
    title: 'Zettelkasten method',
    folder: 'Learning/Education',
    tags: ['notes', 'method'],
    content:
      '# Zettelkasten method\n\nSmall atomic notes that link to each other. Each idea gets its own note, connected by links rather than folders.\n\nSee [[Knowledge graph]] for how links become a map and [[Progressive summarization]] for distilling.\n\n#notes #method',
  },
  {
    title: 'Knowledge graph',
    folder: 'Learning/Education',
    tags: ['graph', 'notes'],
    content:
      '# Knowledge graph\n\nNotes are nodes, [[wikilinks]] are edges. Backlinks show who points at a note. Clusters reveal themes you did not plan.\n\nRelated: [[Zettelkasten method]], [[Why local-first software]].\n\n#graph #notes',
  },
  {
    title: 'Progressive summarization',
    folder: 'Learning/Education',
    tags: ['method'],
    content: '# Progressive summarization\n\nHighlight, then bold, then summarise. Layers of compression make old notes fast to reuse. Pairs well with the [[Zettelkasten method]].\n\n#method',
  },
  {
    title: 'Why local-first software',
    folder: 'Reading',
    tags: ['software', 'local-first'],
    type: 'web',
    url: 'https://www.inkandswitch.com/essay/local-first/',
    content:
      '# Why local-first software\n\nYour data lives on your device, works offline, and syncs when it can. No spinner, no lock-in, you own the files.\n\nMindvault is built this way: see [[Knowledge graph]] and [[Sync with Google Drive]].\n\n---\nSource: <https://www.inkandswitch.com/essay/local-first/>',
  },
  {
    title: 'Sync with Google Drive',
    folder: 'Start here',
    tags: ['sync', 'guide'],
    content: '# Sync with Google Drive\n\nPaste your own OAuth client ID in Settings, sign in once, and your vault follows you across devices. Offline stays fully usable.\n\n#sync #guide',
  },
  {
    title: 'Meeting summary prompt',
    folder: 'AI/Prompts',
    tags: ['prompt', 'meetings'],
    type: 'prompt',
    content:
      'You are an executive assistant. Summarise the meeting transcript below as: decisions, action items with owners, open questions. Keep it under 150 words.\n\nTranscript:\n{{transcript}}',
  },
  {
    title: 'Code review prompt',
    folder: 'AI/Prompts',
    tags: ['prompt', 'code'],
    type: 'prompt',
    content: 'Act as a senior {{language}} engineer. Review the diff for bugs, security issues and readability. Reply with a prioritised list.\n\n{{diff}}',
  },
  {
    title: 'Project ideas',
    folder: 'Personal/Life',
    tags: ['ideas'],
    content: '# Project ideas\n\n- Build a habit tracker that exports to [[Knowledge graph]]\n- Write about [[Why local-first software]]\n- Reading list: [[Papers to read]]\n\n#ideas',
  },
]

/** Insert a small connected demo vault. Returns items to be written by the caller. */
export function sampleItems(): Item[] {
  const now = Date.now()
  return SEEDS.map((s, i) => {
    const suggestion = classify({ title: s.title, content: s.content, url: s.url, forcedType: s.type })
    return {
      id: newId(),
      type: s.type ?? suggestion.type,
      title: s.title,
      content: s.content,
      url: s.url,
      folder: s.folder,
      tags: s.tags,
      status: 'organized' as const,
      createdAt: now - (SEEDS.length - i) * 3_600_000,
      updatedAt: now - (SEEDS.length - i) * 3_600_000,
    }
  })
}
