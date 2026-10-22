import { extractReadable } from '../core/readable'
import { getState } from '../data/store'

declare global {
  interface Window {
    /** Provided by the Electron preload script. */
    mindvault?: { fetchText(url: string): Promise<string>; platform: string }
  }
}

export class ClipError extends Error {}

export function normalizeUrl(input: string): string | null {
  const t = input.trim()
  if (!t || /\s/.test(t)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : null
  if (!withScheme) return null
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Download page HTML. Order: Electron main process (no CORS) -> direct fetch (works inside
 * Capacitor's native HTTP and on CORS-friendly sites) -> user-configured proxy.
 */
export async function fetchHtml(url: string): Promise<string> {
  if (window.mindvault?.fetchText) return window.mindvault.fetchText(url)
  let directError: unknown
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new ClipError(`Server answered ${res.status}`)
    return await res.text()
  } catch (e) {
    directError = e
  }
  const proxy = getState().settings.clipProxy.trim()
  if (proxy) {
    const res = await fetch(proxy.replace('{url}', encodeURIComponent(url)))
    if (!res.ok) throw new ClipError(`Proxy answered ${res.status}`)
    return await res.text()
  }
  throw new ClipError(
    directError instanceof ClipError
      ? directError.message
      : 'The browser blocked this download (CORS). Use the desktop/Android app, set a clip proxy in Settings, or paste the text.',
  )
}

export interface WebClip {
  url: string
  title: string
  markdown: string
}

export async function clipUrl(rawUrl: string): Promise<WebClip> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new ClipError('That does not look like a web address.')
  const html = await fetchHtml(url)
  const r = extractReadable(html, url)
  if (r.markdown.length < 40) throw new ClipError('Could not find readable text on that page.')
  const header = [r.siteName ? `*${r.siteName}*` : '', r.description ? `> ${r.description}` : ''].filter(Boolean).join('\n\n')
  return { url, title: r.title, markdown: `${header ? header + '\n\n' : ''}${r.markdown}\n\n---\nSource: <${url}>` }
}
