import { extractReadable } from '../core/readable'
import { getState } from '../data/store'

declare global {
  interface Window {
    /** Provided by the Electron preload script. */
    mindvault?: {
      fetchText(url: string): Promise<string>
      platform: string
      pair?: {
        get(): Promise<PairInfo>
        setEnabled(enabled: boolean): Promise<PairInfo>
        reset(): Promise<PairInfo>
      }
      onRpc?(handler: (msg: unknown) => Promise<unknown>): void
    }
  }
}

export interface PairInfo {
  enabled: boolean
  token: string
  /** Pairing links to show as QR codes, one per network address. */
  links: string[]
  /** Endpoint the browser bookmarklet posts to. */
  clipUrl: string
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

import type { ClipRoute } from '../core/providers'

const DOWNLOAD_TIMEOUT_MS = 20_000

export interface Downloaded {
  html: string
  /** Which path actually worked, shown by the connection test in Settings. */
  route: ClipRoute
}

/**
 * Download page HTML. Order: Electron main process (no CORS) -> direct fetch (works inside
 * Capacitor's native HTTP and on CORS-friendly sites) -> user-configured proxy.
 */
export async function fetchHtmlWithRoute(url: string): Promise<Downloaded> {
  if (window.mindvault?.fetchText) return { html: await window.mindvault.fetchText(url), route: 'desktop' }
  let directError: unknown
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok) throw new ClipError(`Server answered ${res.status}`)
    return { html: await res.text(), route: isNativeApp() ? 'android' : 'direct' }
  } catch (e) {
    directError = e
  }
  const proxy = getState().settings.clipProxy.trim()
  if (proxy) {
    let res: Response
    try {
      res = await fetch(proxy.replace('{url}', encodeURIComponent(url)), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    } catch (e) {
      throw new ClipError(
        (e as Error)?.name === 'TimeoutError'
          ? 'The clip proxy took too long to answer.'
          : 'The clip proxy could not be reached. Check the address in Settings → Capture.',
      )
    }
    if (!res.ok) throw new ClipError(`The clip proxy answered ${res.status}`)
    return { html: await res.text(), route: 'proxy' }
  }
  throw new ClipError(
    directError instanceof ClipError
      ? directError.message
      : 'The browser blocked this download (CORS). Use the desktop or Android app, or pick a clip proxy in Settings → Capture.',
  )
}

export async function fetchHtml(url: string): Promise<string> {
  return (await fetchHtmlWithRoute(url)).html
}

/** True inside the Capacitor Android app, where fetch is routed through native HTTP. */
export function isNativeApp(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

export interface WebClip {
  url: string
  title: string
  markdown: string
}

export async function clipUrl(rawUrl: string): Promise<WebClip> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new ClipError('That does not look like a web address.')
  return clipFromHtml(await fetchHtml(url), url)
}

/** Turn page HTML (downloaded, or captured from a live browser tab) into a readable Markdown clip. */
export function clipFromHtml(html: string, url: string): WebClip {
  const r = extractReadable(html, url)
  if (r.markdown.length < 40) throw new ClipError('Could not find readable text on that page.')
  const header = [r.siteName ? `*${r.siteName}*` : '', r.description ? `> ${r.description}` : ''].filter(Boolean).join('\n\n')
  return { url, title: r.title, markdown: `${header ? header + '\n\n' : ''}${r.markdown}\n\n---\nSource: <${url}>` }
}
