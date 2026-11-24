/** Small text measurements shown around a note: word count, reading time, backlink excerpts, capture signals. */
import { parseFrontmatter, parseInlineTags } from './markdown'

const WORDS_PER_MINUTE = 230
const WIKILINK = /\[\[([^\]\n]+?)\]\]/g

/** [[Target#heading|alias]] -> "alias" (or "Target"). */
function wikilinksToWords(text: string): string {
  return text.replace(WIKILINK, (_, inner: string) => {
    const [target, ...alias] = inner.split('|')
    return (alias.join('|').trim() || target.split('#')[0].trim())
  })
}

export function wordCount(markdown: string): number {
  const body = parseFrontmatter(markdown).body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, ' ')
  return wikilinksToWords(body)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** Target of a wikilink body: "Note#heading|alias" -> "Note". */
const linkTarget = (inner: string) => inner.split('|')[0].split('#')[0].trim()

/**
 * The line of `content` that links to a note, as plain words, cut to about `max` characters around the link.
 * `target` is the note's title, or a test that says whether a link target points at the note (for slugs and file names).
 */
export function mentionExcerpt(content: string, target: string | ((linkTarget: string) => boolean), max = 140): string | null {
  const isTarget = typeof target === 'string' ? (t: string) => t.toLowerCase() === target.trim().toLowerCase() : target
  for (const line of content.split('\n')) {
    const raw = line.replace(/^\s*(?:>\s*)*(?:[-*+]\s+|\d+\.\s+)?(?:\[[ xX]\]\s+)?/, '')
    const hit = [...raw.matchAll(WIKILINK)].find((m) => isTarget(linkTarget(m[1])))
    if (hit) return excerptAround(raw, hit.index!, max)
  }
  return null
}

function excerptAround(raw: string, at: number, max: number): string {
  const before = wikilinksToWords(raw.slice(0, at))
  const plain = (before + wikilinksToWords(raw.slice(at))).replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  const center = before.length
  const start = Math.max(0, Math.min(center - Math.floor(max / 2), plain.length - max))
  const cut = plain.slice(start, start + max).trim()
  return `${start > 0 ? '…' : ''}${cut}${start + max < plain.length ? '…' : ''}`
}

export interface CaptureSignals {
  words: number
  chars: number
  links: string[]
  tags: string[]
  urls: number
}

/** What a quick capture already contains: shown live while typing. */
export function captureSignals(text: string): CaptureSignals {
  const trimmed = text.trim()
  const links = [...new Set([...trimmed.matchAll(WIKILINK)].map((m) => m[1].split('|')[0].split('#')[0].trim()).filter(Boolean))]
  return {
    words: wordCount(trimmed),
    chars: trimmed.length,
    links,
    tags: parseInlineTags(trimmed),
    urls: (trimmed.match(/https?:\/\/\S+/g) ?? []).length,
  }
}
