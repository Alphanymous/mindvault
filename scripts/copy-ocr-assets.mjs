// Copies the OCR engine into public/ocr so text recognition runs fully offline
// (tesseract.js would otherwise download its worker, wasm core and language data from a CDN).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
const nm = (...p) => join(root, 'node_modules', ...p)

// The worker picks one core build for the device's wasm features, so all three LSTM variants are needed.
const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
]

// Android's build unpacks any .gz asset and drops the suffix, so ship the language data already unzipped.
const langGz = nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')
if (!existsSync(langGz)) throw new Error(`OCR asset missing: ${langGz} (run npm install)`)

mkdirSync(join(out, 'lang'), { recursive: true })
writeFileSync(join(out, 'lang', 'eng.traineddata'), gunzipSync(readFileSync(langGz)))
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`OCR asset missing: ${from} (run npm install)`)
  copyFileSync(from, join(out, to))
}
console.log(`OCR assets copied to public/ocr (${files.length + 1} files)`)
