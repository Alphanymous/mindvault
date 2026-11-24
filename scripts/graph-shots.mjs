#!/usr/bin/env node
/**
 * Screenshot check for the graph cloud. Seeds a vault of N notes across 5 folders (links and tags included),
 * opens #/graph at desktop and phone size in dark and light theme, saves a screenshot of each and prints the
 * node count, the settle time and how many labels overlap (each other, a floating panel or the canvas edge).
 *
 *   npx vite --port 5179 --strictPort          (in another terminal)
 *   node scripts/graph-shots.mjs http://localhost:5179 50 [outDir]
 *
 * Needs a dev server: settle time and label boxes come from window.__graphSettledAt / window.__graphLabels,
 * which GraphCanvas sets only in development builds. Exits 1 if any label overlaps.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [url = 'http://localhost:5179', countArg = '50', outArg] = process.argv.slice(2)
const count = Math.max(1, Number(countArg) || 50)
const outDir = resolve(outArg ?? join(tmpdir(), 'mindvault-graph-shots'))
mkdirSync(outDir, { recursive: true })

const FOLDERS = ['Research', 'Projects', 'Journal', 'Reading', 'Ideas']
const SUB = { Research: ['AI', 'Neuroscience'], Projects: ['Mindvault'], Reading: ['Books'] }
const WORDS = ['memory', 'attention', 'habits', 'sleep', 'focus', 'graphs', 'writing', 'design', 'learning', 'systems', 'notes', 'music',
  'running', 'cooking', 'garden', 'travel', 'budget', 'ideas', 'language', 'models', 'search', 'privacy', 'sync', 'offline', 'colour', 'maps']
const SHAPES = ['Notes on {a}', '{A} and {b}', 'Why {a} matters', 'A short guide to {a}', '{A}', 'Thoughts about {a} and {b} this week',
  '{A} reading list', 'How {a} shapes {b}', 'Open questions on {a}', '{A} experiment log']
const TAGS = ['todo', 'idea', 'reference', 'draft', 'question', 'favourite', 'review']

/** Small deterministic PRNG, so every run builds the same vault. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildVault(n) {
  const rnd = random(7)
  const pickOne = (list) => list[Math.floor(rnd() * list.length)]
  const cap = (s) => s[0].toUpperCase() + s.slice(1)
  const items = []
  const titles = new Set()
  for (let i = 0; i < n; i++) {
    const top = FOLDERS[i % FOLDERS.length]
    const folder = SUB[top] && rnd() < 0.35 ? `${top}/${pickOne(SUB[top])}` : top
    let title
    do {
      const a = pickOne(WORDS), b = pickOne(WORDS)
      title = pickOne(SHAPES).replace('{a}', a).replace('{b}', b).replace('{A}', cap(a)).replace('{B}', cap(b))
    } while (titles.has(title))
    titles.add(title)
    const tags = TAGS.filter(() => rnd() < 0.18)
    const created = Date.now() - (n - i) * 3600_000
    items.push({ id: `seed${i}`, type: rnd() < 0.8 ? 'note' : pickOne(['web', 'pdf', 'prompt', 'file']), title, content: '', folder, tags, status: 'organized', createdAt: created, updatedAt: created })
  }
  // Links: mostly to earlier notes in the same top folder, some across; the first note of each folder is a busy hub.
  items.forEach((it, i) => {
    const top = it.folder.split('/')[0]
    const same = items.slice(0, i).filter((o) => o.folder.split('/')[0] === top)
    const other = items.slice(0, i).filter((o) => o.folder.split('/')[0] !== top)
    const links = []
    if (same.length && rnd() < 0.35) links.push(same[0].title)
    for (let k = 0; k < 1 + Math.floor(rnd() * 2); k++) {
      const pool = rnd() < 0.8 ? same : other
      if (pool.length) links.push(pickOne(pool).title)
    }
    it.content = `# ${it.title}\n\nSome words about ${it.title.toLowerCase()}.\n\n${[...new Set(links)].map((t) => `See [[${t}]].`).join('\n')}\n`
  })
  return items
}

async function seed(page, items, theme) {
  await page.goto(`${url}/#/library`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(
    ({ items, theme }) =>
      new Promise((done, fail) => {
        const req = indexedDB.open('mindvault', 1)
        req.onupgradeneeded = () => {
          const d = req.result
          for (const name of ['items', 'blobs']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' })
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta')
        }
        req.onerror = () => fail(req.error)
        req.onsuccess = () => {
          const d = req.result
          const tx = d.transaction(['items', 'meta'], 'readwrite')
          tx.objectStore('items').clear()
          for (const it of items) tx.objectStore('items').put(it)
          tx.objectStore('meta').put({ theme }, 'settings')
          tx.oncomplete = () => { d.close(); done() }
          tx.onerror = () => fail(tx.error)
        }
      }),
    { items, theme },
  )
  await page.reload()
  await page.waitForLoadState('networkidle')
}

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

async function measure(page) {
  return page.evaluate(() => {
    const labels = (window.__graphLabels ?? []).map((l) => ({ text: l.text, ...l.box }))
    const canvas = document.querySelector('.graph-canvas').getBoundingClientRect()
    const panels = [...document.querySelectorAll('.graph-search-wrap, .atlas, .graph-panel, .graph-card, .graph-zoom, .graph-options-btn')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => ({ x: r.left - canvas.left, y: r.top - canvas.top, w: r.width, h: r.height }))
    return { nodes: window.__graphNodes ? window.__graphNodes().length : 0, labels, panels, w: canvas.width, h: canvas.height }
  })
}

const items = buildVault(count)
const browser = await chromium.launch()
let failures = 0
try {
  for (const theme of ['dark', 'light']) {
    for (const [name, viewport] of [['desktop', { width: 1400, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: name === 'phone', hasTouch: name === 'phone' })
      const page = await context.newPage()
      page.on('pageerror', (e) => { console.error(`page error: ${e.message}`); failures++ })
      await seed(page, items, theme)
      await page.evaluate(() => {
        window.__t0 = performance.now()
        location.hash = '#/graph'
      })
      await page.waitForFunction(() => window.__graphSettledAt > window.__t0, null, { timeout: 30000 })
      const settle = await page.evaluate(() => window.__graphSettledAt - window.__t0)
      await page.waitForTimeout(1500) // let the camera finish framing the settled cloud
      const report = async (view, settleMs) => {
        const m = await measure(page)
        let overlaps = 0, onPanels = 0, offCanvas = 0
        m.labels.forEach((a, i) => {
          for (const b of m.labels.slice(i + 1)) if (intersects(a, b)) overlaps++
          if (m.panels.some((p) => intersects(a, p))) onPanels++
          if (a.x < 0 || a.y < 0 || a.x + a.w > m.w || a.y + a.h > m.h) offCanvas++
        })
        const file = join(outDir, `graph-${view}-${theme}-${name}-${count}.png`)
        await page.screenshot({ path: file })
        console.log(`${view.padEnd(5)} ${theme.padEnd(5)} ${name.padEnd(7)} nodes ${String(m.nodes).padStart(5)}  settle ${settleMs === undefined ? '    -' : String(Math.round(settleMs)).padStart(5)} ms  labels ${String(m.labels.length).padStart(2)}  overlaps ${overlaps}  on panels ${onPanels}  off canvas ${offCanvas}  ${file}`)
        if (overlaps || onPanels || offCanvas) failures++
      }
      await report('cloud', settle)
      const pressed = (label) => page.evaluate((l) => [...document.querySelectorAll('.graph-view-switch button')].find((b) => b.textContent === l)?.getAttribute('aria-pressed') === 'true', label)
      const check = (ok, what) => { if (!ok) { console.error(`FAIL: ${what}`); failures++ } }
      check(await pressed('Cloud'), 'Cloud is the default view')
      // Atlas: the switch changes the scene
      await page.click('.graph-view-switch button:has-text("Atlas")')
      await page.waitForTimeout(2500)
      check(await pressed('Atlas'), 'switch shows Atlas after clicking it')
      await report('atlas')
      if (theme === 'dark' && name === 'desktop') {
        // remembered per device
        await page.reload()
        await page.waitForSelector('.graph-view-switch')
        check(await pressed('Atlas'), 'Atlas is still selected after a reload')
        // Open in graph always shows Cloud, and leaves the remembered choice alone
        await page.evaluate(() => { location.hash = '#/graph?focus=seed3' })
        await page.reload()
        await page.waitForSelector('.graph-view-switch')
        check(await pressed('Cloud'), '#/graph?focus=<id> opens Cloud')
        check((await page.evaluate(() => localStorage.getItem('mv.graph.view'))) === 'atlas', 'focus link keeps the stored view')
        // Esc in Atlas: deselects a note first, then flies back to the ring
        await page.evaluate(() => { location.hash = '#/graph' })
        await page.reload()
        await page.waitForSelector('.graph-view-switch')
        check(await pressed('Atlas'), 'stored Atlas returns after the focus link')
        await page.click('.atlas-list li:nth-child(2) button')
        await page.waitForTimeout(1500)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(1500)
        check((await page.evaluate(() => (window.__graphLabels ?? []).filter((l) => l.kind === 'region').length)) >= 3, 'Esc in Atlas returns to the ring of regions')
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
process.exit(failures ? 1 : 0)
