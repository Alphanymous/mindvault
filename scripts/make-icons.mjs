// Renders public/icon.svg into the PNG sizes needed by the PWA, Electron and Android.
import sharp from 'sharp'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('public/icon.svg')
mkdirSync('build', { recursive: true })
const targets = [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['build/icon.png', 512],
]
for (const [file, size] of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(file)
  console.log('wrote', file)
}
// Android adaptive icon sources for @capacitor/assets (optional)
mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon-only.png', await sharp(svg, { density: 384 }).resize(1024, 1024).png().toBuffer())
console.log('wrote assets/icon-only.png')

// Windows .ico built from PNG frames (PNG-in-ICO is supported since Vista). Written by hand because
// electron-builder's own ico tool fails with a WebAssembly memory error on some machines.
const sizes = [16, 32, 48, 64, 128, 256]
const frames = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = 6 + frames.length * 16
const entries = frames.map((buf, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0)
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += buf.length
  return e
})
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...frames]))
console.log('wrote build/icon.ico')
