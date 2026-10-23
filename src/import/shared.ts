/** Interpret what other apps hand us through a share sheet (Android intent, PWA share target). */

export interface SharedInput {
  title?: string | null
  text?: string | null
  url?: string | null
}

export type SharedParsed = { kind: 'url'; url: string; title?: string } | { kind: 'text'; text: string; title?: string }

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i

const clean = (s?: string | null) => (s ?? '').trim()

/**
 * Chrome shares "https://page" in the text field; many apps share "Headline https://page".
 * A link on its own, or a link that ends the text, becomes a web clip. Longer text stays a note.
 */
export function parseShared(input: SharedInput): SharedParsed | null {
  const title = clean(input.title) || undefined
  const url = clean(input.url)
  const text = clean(input.text)

  if (/^https?:\/\/\S+$/i.test(url)) return { kind: 'url', url, title }
  if (!text) return title ? parseShared({ text: title }) : null

  const m = URL_RE.exec(text)
  if (m) {
    const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim()
    const endsWithLink = text.endsWith(m[0])
    if (!rest || (endsWithLink && rest.length <= 200 && !rest.includes('\n\n'))) {
      return { kind: 'url', url: m[0].replace(/[.,;:!?]+$/, ''), title: title ?? (rest || undefined) }
    }
  }
  return { kind: 'text', text, title }
}
