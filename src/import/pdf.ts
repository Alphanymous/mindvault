import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfExtract {
  title?: string
  text: string
  pages: number
}

const MAX_CHARS = 600_000

/** Extract plain text (paragraph-ish) from a PDF. Runs fully offline in the browser. */
export async function extractPdf(data: ArrayBuffer): Promise<PdfExtract> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
  const doc = await task.promise
  try {
    let title: string | undefined
    try {
      const meta = await doc.getMetadata()
      const info = meta.info as { Title?: string } | undefined
      if (info?.Title && info.Title.trim().length > 2) title = info.Title.trim()
    } catch {
      /* metadata is optional */
    }
    const chunks: string[] = []
    let total = 0
    for (let p = 1; p <= doc.numPages && total < MAX_CHARS; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        line += raw.str
        if (raw.hasEOL) {
          lines.push(line)
          line = ''
        } else if (raw.str && !raw.str.endsWith(' ')) {
          line += ' '
        }
      }
      if (line) lines.push(line)
      const text = joinLines(lines)
      chunks.push(doc.numPages > 1 ? `## Page ${p}\n\n${text}` : text)
      total += text.length
      page.cleanup()
    }
    return { title, text: chunks.join('\n\n').trim(), pages: doc.numPages }
  } finally {
    await task.destroy()
  }
}

/** Join wrapped lines into paragraphs; blank-ish gaps become paragraph breaks. */
export function joinLines(lines: string[]): string {
  const out: string[] = []
  let para = ''
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ').trim()
    if (!l) {
      if (para) out.push(para)
      para = ''
      continue
    }
    if (para.endsWith('-') && /^[a-z]/.test(l)) para = para.slice(0, -1) + l
    else para = para ? `${para} ${l}` : l
    if (/[.!?:]$/.test(l) && l.length < 60) {
      out.push(para)
      para = ''
    }
  }
  if (para) out.push(para)
  return out.join('\n\n')
}
