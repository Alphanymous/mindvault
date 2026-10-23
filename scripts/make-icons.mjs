// Draws the Mindvault icon (black + gold vault dial with a connected graph) and renders every size needed:
// PWA, Electron/Windows (.ico), Android launcher + adaptive icons + splash. Run: npm run icons
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const GOLD_HI = '#ffe08a'
const GOLD = '#f2b632'
const GOLD_LO = '#c98a12'
const BLACK = '#0b0a08'

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#201808"/><stop offset="1" stop-color="${BLACK}"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD_HI}"/><stop offset=".55" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD_LO}"/></linearGradient>
  </defs>`

// Vault dial: ring with 12 tick marks, three linked nodes in the middle.
const ticks = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6
  const r1 = 168
  const r2 = i % 3 === 0 ? 144 : 154
  const x = (r) => (256 + Math.sin(a) * r).toFixed(1)
  const y = (r) => (256 - Math.cos(a) * r).toFixed(1)
  return `<line x1="${x(r1)}" y1="${y(r1)}" x2="${x(r2)}" y2="${y(r2)}"/>`
}).join('')

const art = `
  <circle cx="256" cy="256" r="196" fill="none" stroke="url(#gold)" stroke-width="16"/>
  <g stroke="url(#gold)" stroke-width="8" stroke-linecap="round" opacity=".85">${ticks}</g>
  <g stroke="url(#gold)" stroke-width="13" stroke-linecap="round" opacity=".9">
    <line x1="256" y1="196" x2="198" y2="296"/><line x1="256" y1="196" x2="314" y2="296"/><line x1="198" y1="296" x2="314" y2="296"/>
  </g>
  <circle cx="256" cy="196" r="34" fill="url(#gold)"/>
  <circle cx="198" cy="296" r="26" fill="url(#gold)"/>
  <circle cx="314" cy="296" r="26" fill="url(#gold)"/>`

const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" rx="112" fill="url(#bg)"/>${art}</svg>`
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<rect width="512" height="512" fill="url(#bg)"/>${art}</svg>`
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<circle cx="256" cy="256" r="256" fill="url(#bg)"/>${art}</svg>`
// Adaptive foreground: art only, shrunk into the 66dp safe zone of the 108dp canvas.
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<g transform="translate(256 256) scale(.7) translate(-256 -256)">${art}</g></svg>`

writeFileSync('public/icon.svg', full)

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer()
const out = async (file, svg, size) => {
  writeFileSync(file, await png(svg, size))
  console.log('wrote', file)
}

mkdirSync('build', { recursive: true })
mkdirSync('assets', { recursive: true })
await out('public/icon-192.png', full, 192)
await out('public/icon-512.png', full, 512)
await out('public/icon-maskable-512.png', square, 512)
await out('build/icon.png', full, 512)
await out('assets/icon-only.png', full, 1024)

// Windows .ico built from PNG frames (PNG-in-ICO is supported since Vista). Written by hand because
// electron-builder's own ico tool fails with a WebAssembly memory error on some machines.
const sizes = [16, 32, 48, 64, 128, 256]
const frames = await Promise.all(sizes.map((s) => png(full, s)))
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

// Android launcher icons (legacy, round, adaptive foreground) and splash
const res = 'android/app/src/main/res'
const densities = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] }
for (const [d, [legacy, fg]] of Object.entries(densities)) {
  const dir = `${res}/mipmap-${d}`
  mkdirSync(dir, { recursive: true })
  await out(`${dir}/ic_launcher.png`, full, legacy)
  await out(`${dir}/ic_launcher_round.png`, round, legacy)
  await out(`${dir}/ic_launcher_foreground.png`, foreground, fg)
}
writeFileSync(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLACK.toUpperCase()}</color>\n</resources>\n`)
writeFileSync(
  `${res}/values/colors.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="colorPrimary">${BLACK.toUpperCase()}</color>\n    <color name="colorPrimaryDark">${BLACK.toUpperCase()}</color>\n    <color name="colorAccent">${GOLD.toUpperCase()}</color>\n</resources>\n`,
)
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="${BLACK}"/><g transform="translate(350 350) scale(.6)">${defs}${art}</g></svg>`
writeFileSync(`${res}/drawable/splash.png`, await sharp(Buffer.from(splashSvg), { density: 144 }).resize(1080, 1080).png().toBuffer())
console.log('wrote splash + android icons')
