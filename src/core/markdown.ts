/** Parsing helpers for Obsidian-style Markdown: frontmatter, [[wikilinks]], #tags. */

export interface WikiLink {
  /** Raw target text before "|" or "#". */
  target: string
  heading?: string
  alias?: string
}

export interface Frontmatter {
  data: Record<string, string | string[]>
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(text: string): Frontmatter {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}
  const lines = m[1].split(/\r?\n/)
  let currentKey: string | null = null
  for (const line of lines) {
    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem && currentKey) {
      const prev = data[currentKey]
      const arr = Array.isArray(prev) ? prev : prev ? [prev] : []
      arr.push(unquote(listItem[1]))
      data[currentKey] = arr
      continue
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    currentKey = kv[1].toLowerCase()
    const value = kv[2].trim()
    if (value === '') {
      data[currentKey] = []
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
    } else {
      data[currentKey] = unquote(value)
    }
  }
  return { data, body: text.slice(m[0].length) }
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

/** Remove fenced code blocks and inline code so their content is not parsed. */
export function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g

export function parseWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = []
  const src = stripCode(text)
  for (const m of src.matchAll(WIKILINK_RE)) {
    const inner = m[1]
    const [targetPart, ...aliasParts] = inner.split('|')
    const alias = aliasParts.length ? aliasParts.join('|').trim() : undefined
    const [target, ...headingParts] = targetPart.split('#')
    const t = target.trim()
    if (!t) continue
    out.push({ target: t, heading: headingParts.length ? headingParts.join('#').trim() : undefined, alias })
  }
  return out
}

/** #tag, #nested/tag. Must not be a heading ("# Title") or part of a URL/anchor. */
export function parseInlineTags(text: string): string[] {
  const src = stripCode(text).replace(/\[\[[^\]]*\]\]/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  const tags = new Set<string>()
  for (const m of src.matchAll(/(^|[\s(,;])#([\p{L}][\p{L}\p{N}_/-]*)/gu)) {
    tags.add(normalizeTag(m[2]))
  }
  return [...tags]
}

export function normalizeTag(tag: string): string {
  return tag
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
}

export function frontmatterTags(fm: Frontmatter): string[] {
  const raw = fm.data.tags ?? fm.data.tag
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : raw.split(/[,\s]+/)
  return list.map(normalizeTag).filter(Boolean)
}

export function firstHeading(text: string): string | undefined {
  const m = /^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(stripCode(parseFrontmatter(text).body))
  return m?.[1].trim()
}

/** Title from filename: "my-note.md" -> "my note". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain-text excerpt for lists and search results. */
export function excerpt(text: string, max = 180): string {
  const plain = parseFrontmatter(text)
    .body.replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}

/** Words in a text, lowercased, unicode-aware. */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []
}
