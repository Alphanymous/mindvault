import { layoutOcr, type OcrWord } from '../core/ocrLayout'

/**
 * Reads the text out of an image as Markdown, fully offline: the engine and English data ship inside the app
 * (public/ocr). Tesseract's own text output reads straight across the page and mixes columns together, so we
 * take its word positions and rebuild columns, paragraphs, headings and lists (core/ocrLayout).
 */
export async function recognizeImage(image: Blob): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js')
  const base = new URL('ocr/', document.baseURI).href
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    // The language data ships unzipped (Android strips .gz assets).
    gzip: false,
    // Load the worker straight from our own origin instead of wrapping it in a blob.
    workerBlobURL: false,
    logger: () => {},
  })
  try {
    // Sparse mode finds every piece of text (sidebars, labels) without guessing a layout; we build the layout.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    const words: OcrWord[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    return words.length ? layoutOcr(words) : data.text.trim()
  } finally {
    await worker.terminate()
  }
}
