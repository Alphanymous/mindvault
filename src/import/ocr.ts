/** Reads the text out of an image, fully offline: the engine and English data ship inside the app (public/ocr). */
export async function recognizeImage(image: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
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
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
