import { firstHeading, parseFrontmatter, titleFromFileName } from '../core/markdown'
import type { Item } from '../core/types'
import { createItem } from '../data/store'
import { extractPdf } from './pdf'
import type { ClipPayload } from '../sync/pairing'
import { parseShared, type SharedInput } from './shared'
import { clipFromHtml, clipUrl, normalizeUrl } from './web'

export interface CaptureResult {
  item?: Item
  warning?: string
  error?: string
}

/** One entry point for pasted text: link -> web clip, anything else -> note/prompt. */
export async function captureText(raw: string): Promise<CaptureResult> {
  const text = raw.trim()
  if (!text) return { error: 'Nothing to save.' }
  const url = normalizeUrl(text)
  if (url) return captureUrl(url)
  const fm = parseFrontmatter(text)
  const title = typeof fm.data.title === 'string' ? fm.data.title : firstHeading(text)
  return { item: await createItem({ title, content: text }) }
}

export async function captureUrl(url: string, titleHint?: string): Promise<CaptureResult> {
  try {
    const clip = await clipUrl(url)
    return { item: await createItem({ type: 'web', title: clip.title, content: clip.markdown, url: clip.url }) }
  } catch (e) {
    // Never lose the link: save it anyway and say why the text is missing.
    const normalized = normalizeUrl(url) ?? url
    const item = await createItem({
      type: 'web',
      title: titleHint || hostTitle(normalized),
      content: `Saved link only.\n\n<${normalized}>`,
      url: normalized,
    })
    return { item, warning: `${e instanceof Error ? e.message : 'Could not read the page'} Saved the link only.` }
  }
}

function hostTitle(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '')
  } catch {
    return url
  }
}

export async function captureFile(file: File): Promise<CaptureResult> {
  const name = file.name
  const lower = name.toLowerCase()
  try {
    if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
      const buf = await file.arrayBuffer()
      let text = ''
      let title: string | undefined
      let warning: string | undefined
      try {
        const r = await extractPdf(buf)
        text = r.text
        title = r.title
        if (!text) warning = 'This PDF has no selectable text (scanned?). Saved the original only.'
      } catch {
        warning = 'Could not read the PDF text. Saved the original only.'
      }
      const item = await createItem({
        type: 'pdf',
        title: title ?? titleFromFileName(name),
        content: text || `PDF file: ${name}`,
        fileName: name,
        mime: 'application/pdf',
        size: file.size,
        blob: file,
      })
      return { item, warning }
    }
    if (/\.(md|markdown|txt)$/.test(lower) || file.type.startsWith('text/')) {
      const content = await file.text()
      const fm = parseFrontmatter(content)
      const title = (typeof fm.data.title === 'string' && fm.data.title) || firstHeading(content) || titleFromFileName(name)
      return { item: await createItem({ title, content, fileName: name, mime: file.type || 'text/markdown', size: file.size }) }
    }
    return {
      item: await createItem({
        type: 'file',
        title: titleFromFileName(name),
        content: `File: ${name}`,
        fileName: name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        blob: file,
      }),
    }
  } catch (e) {
    return { error: `${name}: ${e instanceof Error ? e.message : 'import failed'}` }
  }
}

/** Something another app shared with us (Android share sheet, PWA share target). */
export async function captureShared(input: SharedInput): Promise<CaptureResult> {
  const parsed = parseShared(input)
  if (!parsed) return { error: 'Nothing to save.' }
  if (parsed.kind === 'url') return captureUrl(parsed.url, parsed.title)
  return { item: await createItem({ title: parsed.title, content: parsed.text }) }
}

/** A page sent from the desktop browser bookmarklet: already rendered, so no download is needed. */
export async function captureClip(clip: ClipPayload): Promise<CaptureResult> {
  if (clip.selection.trim()) {
    const quote = clip.selection
      .trim()
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    const title = clip.title || hostTitle(clip.url)
    const content = `# ${title}\n\n${quote}\n\n---\nSource: <${clip.url}>`
    return { item: await createItem({ type: 'web', title, content, url: clip.url }) }
  }
  try {
    const page = clipFromHtml(clip.html, clip.url)
    return { item: await createItem({ type: 'web', title: clip.title || page.title, content: page.markdown, url: clip.url }) }
  } catch {
    return captureUrlLinkOnly(clip)
  }
}

async function captureUrlLinkOnly(clip: ClipPayload): Promise<CaptureResult> {
  const item = await createItem({
    type: 'web',
    title: clip.title || hostTitle(clip.url),
    content: `Saved link only.\n\n<${clip.url}>`,
    url: clip.url,
  })
  return { item, warning: 'No readable text on that page. Saved the link only.' }
}
