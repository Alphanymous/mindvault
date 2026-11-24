# Graph Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mindvault's spinning 3D galaxy graph with an EleSync-style compact, round "brain" cloud plus a separate orb-ring Atlas view, and remove the note-page mini graph.

**Architecture:** A pure 2D force layout (`src/core/cloudLayout.ts`, port of EleSync's `dashboard-graph-layout.js` plus region anchors) and a pure label placer (`src/ui/graphLabels.ts`) feed a rewritten canvas component (`src/ui/GraphCanvas.tsx`) that draws the cloud with a fake-3D sway; an Atlas scene (`src/ui/graphAtlas.ts`, port of `dashboard-graph-atlas.js`) is the canvas's second view. Region colours become name-derived in `src/core/clusters.ts`.

**Tech Stack:** React 19, TypeScript, canvas 2D, Vitest (jsdom where DOM is needed), Playwright (Chromium preinstalled) for screenshot checks.

**Spec:** `docs/superpowers/specs/2026-11-24-graph-cloud-design.md`

**Reference (read, don't import):** `/home/user/darknodebros/elesync/elesync/static/dashboard-graph-layout.js`, `dashboard-graph.js` (seed, colours, sizes, sway `place()`, labels), `dashboard-graph-atlas.js`. Clone with `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/darknodebros/elesync /home/user/darknodebros/elesync` if missing.

## Global Constraints

- React 19 + TypeScript, canvas 2D only; no new graphics libraries; no new runtime dependencies.
- `GraphCanvas` keeps its props (`data`, `selectedId`, `onSelect`, `onOpen`, `compact?`, `highlight?`) and adds only `view?: 'cloud' | 'atlas'`.
- `GraphHandle` keeps `zoomBy(factor)`, `fit()`, `focusSelected()`, `toggleSpin(): boolean`, `focusRegion(name)`.
- Call sites: `GraphView.tsx` (full page) and `Home.tsx` (compact). The `ItemView.tsx` mini graph is removed; its "Open in graph" button stays.
- Keep: search highlight dims the rest, click selects, double-click / Enter opens, hover, keyboard in `GraphView` (F, Tab, Enter, Esc), `prefers-reduced-motion`, light and dark themes, item-kind shapes (dot note, ring web page, double ring PDF, cross prompt, square file).
- Regions stay top-level folders (`regionOf` / `regionOfFolder`); palette stays `REGION_HUES`.
- Sway ±0.45 rad; sizes 70/25/5 % small/medium/large; ambient drift below 3000 nodes; plain dots above 3500 until zoomed in; Atlas max 12 orbs ("Everything else"), dust sampled above 2200, fan up to 150 newest.
- Labels default: region names + 5 busiest notes; focus: focused note + up to 14 neighbours; zoomed in: up to 60; compact: no region names, selected always, at most 6 others. No label overlaps another label, a region name, a floating panel or the canvas edge.
- Before every push: `npm test` and `npm run build` must both exit 0 (check the exit status, not the output text).

## Review Focus

1. **Empty or tiny vault** (0, 1 or 2 notes, no links): layout returns finite positions, canvas draws without throwing, Atlas shows one orb. Tests in Task 2 and Task 5.
2. **Notes with no folder and no links** (Unfiled, Folders off): they still form their own lobe rather than collapsing into the centre. Test in Task 2.
3. **Data changes while the graph is open** (search, "Only this neighbourhood", Hide unconnected, a note added): existing nodes keep their positions (warm start) and region colours don't change. Tests in Task 1 and Task 2.
4. **Very long titles and labels near the canvas edge or under the settings panel**: truncated, flipped or skipped, never overlapping or clipped mid-pill. Test in Task 3.
5. **Large vault on a phone** (2000 notes at 390×844): settles in under ~3 s and keeps animating without stalls. Check in Task 7.

---

### Task 1: Name-derived region colours

**Files:**
- Modify: `src/core/clusters.ts`
- Modify: `src/ui/GraphView.tsx` (regions from all live notes), `src/ui/ClustersPage.tsx` (same function)
- Test: `src/core/clusters.test.ts`

**Interfaces:**
- Produces: `regionHue(name: string): number` (one of `REGION_HUES`, from a hash of the name; `UNFILED` always maps to a fixed muted hue `214`); `buildRegions(nodes: GraphNode[]): Region[]` keeps its signature but uses `regionHue` and still sorts by name.

- [ ] **Step 1: Write the failing tests** in `clusters.test.ts`:

```ts
it('gives a region the same colour whatever other regions exist', () => {
  const before = buildRegions([item('a', 'Research'), item('b', 'Reading')])
  const after = buildRegions([item('a', 'Research'), item('b', 'Reading'), item('c', 'Archive')])
  expect(after.find((r) => r.name === 'Research')!.hue).toBe(before.find((r) => r.name === 'Research')!.hue)
  expect(after.find((r) => r.name === 'Reading')!.hue).toBe(before.find((r) => r.name === 'Reading')!.hue)
})
it('derives hues from the palette, deterministically', () => {
  expect(REGION_HUES).toContain(regionHue('Projects'))
  expect(regionHue('Projects')).toBe(regionHue('Projects'))
})
```

- [ ] **Step 2: Run** `npx vitest run src/core/clusters.test.ts`. Expected: FAIL (`regionHue` not exported, hue changes).
- [ ] **Step 3: Implement `regionHue`** (use `hash01(name)` style string hash → index into `REGION_HUES`) and use it in `buildRegions`. Update any existing test that asserted alphabetical hues.
- [ ] **Step 4: In `GraphView.tsx`**, compute `regions` from `buildGraph(live).nodes` (all live notes), not from the filtered `data`; `ClustersPage` already uses all notes and now gets the same hues via `buildRegions`.
- [ ] **Step 5: Run** `npx vitest run` — all pass.
- [ ] **Step 6: Commit** `feat(graph): region colours come from the folder name`.

### Task 2: Cloud layout engine

**Files:**
- Create: `src/core/cloudLayout.ts`
- Test: `src/core/cloudLayout.test.ts`
- Modify: `src/core/types.ts`, `src/core/links.ts` (add `createdAt?: number` to item `GraphNode`s, used by Atlas in Task 5)

**Interfaces:**
- Consumes: `GraphData`, `regionOf` from `clusters.ts`.
- Produces:

```ts
export interface CloudNode { id: string; node: GraphNode; region: string | null; x: number; y: number; vx: number; vy: number; charge: number; mass: number; degree: number; pinned: boolean }
export interface CloudLayout {
  nodes: CloudNode[]
  index: Map<string, number>
  edges: { a: number; b: number; kind: EdgeKind }[]
  tick(): boolean            // false once settled
  reheat(level: number): void
  readonly settled: boolean
  /** Centre of each region's lobe, for labels and focusRegion. */
  regionCentres(): Map<string, { x: number; y: number; radius: number }>
}
export function createCloudLayout(data: GraphData, prev?: CloudLayout): CloudLayout
export function regionAnchor(name: string, regionCount: number): { x: number; y: number }
```

- [ ] **Step 1: Write the failing tests** (build test graphs with a small helper: N notes across R folders, some links):

```ts
it('settles into a round cloud', () => {   // 200 notes, 5 regions, 150 links
  const l = settle(createCloudLayout(g)) // tick until !tick() or 2000 ticks
  expect(l.settled).toBe(true)
  const { w, h } = extent(l.nodes)        // 5th–95th percentile spread on x and y
  expect(w / h).toBeGreaterThan(0.75); expect(w / h).toBeLessThan(1.33)
})
it('never produces NaN or infinite positions, even for 0, 1 and 2 nodes', ...)
it('is deterministic for the same data', ...)     // two layouts, same positions within 1e-6
it('keeps each region together as a lobe without any links', () => {
  // 120 notes, 4 folders + unfiled, zero edges: mean distance to own region centre
  // is less than half the mean distance to other region centres
})
it('keeps existing positions when a node is added (warm start)', () => {
  // settle, add one note, createCloudLayout(g2, prev): every old node moves < 5 units before ticking
})
it('places a region on the same anchor whatever other regions exist', () => {
  expect(regionAnchor('Research', 5)).toEqual(regionAnchor('Research', 5))
})
```

- [ ] **Step 2: Run** `npx vitest run src/core/cloudLayout.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** by porting `createGraphLayout` (Barnes-Hut quadtree with typed-array pools, θ² = 0.81, alpha cooling, decay 0.9772 / 0.95 above 5000 nodes, max speed 40, damping ×0.6, degree-scaled `pull`/`spread`/`bias`), with EleSync's defaults `center 0.4, repel 1.6, link 1, distance 40`. Add a region-anchor force: each node with a region gets `vx += (anchor.x - x) * 0.012 * alpha` (tune so the lobe test passes without stretching the cloud). Region anchors sit on a golden-angle spiral whose angle comes from a hash of the region name and whose ring radius scales with `sqrt(regionCount)` (EleSync `seed()`: `38 * sqrt(i + 0.5) * sqrt(groups)`). Seed new nodes near their region anchor with `hash01(id)` jitter; copy `x, y` from `prev` for ids it already has. Hubs (folder/tag) get EleSync's charge/mass (folder like project: charge 4, mass 3; tag: 2.5, 2; notes 1, 1).
- [ ] **Step 4: Run** the tests — PASS. Then `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `feat(graph): EleSync-style cloud layout with region lobes`.

### Task 3: Label placement

**Files:**
- Create: `src/ui/graphLabels.ts`
- Test: `src/ui/graphLabels.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LabelRequest { id: string; text: string; x: number; y: number; dotRadius: number; priority: number; size: number; kind: 'note' | 'region' | 'hub' }
export interface PlacedLabel extends LabelRequest { box: { x: number; y: number; w: number; h: number }; text: string; side: 'right' | 'left' }
export function placeLabels(requests: LabelRequest[], measure: (text: string, size: number) => number, bounds: { w: number; h: number }, obstacles: { x: number; y: number; w: number; h: number }[], maxChars = 44): PlacedLabel[]
```

- [ ] **Step 1: Write the failing tests:**

```ts
it('never returns two overlapping labels', ...)               // 200 random requests in 400×300
it('places higher priority first and skips what no longer fits', ...)
it('flips a label to the left of its dot near the right edge', ...)
it('skips labels that would cover an obstacle (a panel)', ...)
it('truncates long text with an ellipsis at maxChars', () => {
  const [p] = placeLabels([req({ text: 'x'.repeat(80) })], measure, big, [])
  expect(p.text).toHaveLength(44); expect(p.text.endsWith('…')).toBe(true)
})
it('keeps every placed box inside the bounds', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/ui/graphLabels.test.ts` — FAIL.
- [ ] **Step 3: Implement**: sort by priority desc; for each, build the right-side box (EleSync: `x + r*1.2 + 6`), flip left if it crosses `bounds.w - 6`; reject if it intersects any placed box (with 3 px padding), any obstacle, or leaves bounds.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(graph): collision-free label placement`.

### Task 4: Cloud renderer (rewrite `GraphCanvas`)

**Files:**
- Modify (rewrite): `src/ui/GraphCanvas.tsx`
- Modify: `src/ui/graphFx.ts` (keep only helpers still used: palette, sky/dust/glow sprites, `drawLabelPill`, `drawRipple`, easing)
- Delete: `src/core/galaxy.ts`, `src/core/galaxy.test.ts`
- Modify: `src/ui/ItemView.tsx` (remove the "Local graph" panel and its `GraphCanvas` import; keep the "Open in graph" link as a plain button in that place), `src/ui/Home.tsx` (compact preview unchanged in props; CTA text "Open the graph")
- Test: `src/ui/GraphCanvas.test.ts` (jsdom smoke) and Playwright check script in `scripts/graph-shots.mjs`

**Interfaces:**
- Consumes: `createCloudLayout`, `CloudLayout` (Task 2), `placeLabels` (Task 3), `buildRegions`, `regionHue`, `regionRgb` (Task 1).
- Produces: `GraphCanvas` with the unchanged props plus `view?: 'cloud' | 'atlas'` (Atlas wired in Task 5; until then `'atlas'` renders the cloud); unchanged `GraphHandle`.

- [ ] **Step 1: Write the failing smoke test** (jsdom; stub `HTMLCanvasElement.prototype.getContext` with a recording fake): renders with 0, 1 and 50 nodes without throwing; `ref.current.fit()`, `zoomBy(1.2)`, `focusRegion('Research')`, `toggleSpin()` don't throw; `toggleSpin()` returns false then true.
- [ ] **Step 2: Run** — FAIL (old component imports `galaxy` behaviour / API differences; delete the old test of galaxy).
- [ ] **Step 3: Rewrite `GraphCanvas`**: one `CloudLayout` per data change (pass previous for warm start), ticked in `requestAnimationFrame` until settled, then idle except sway/drift. Projection per EleSync `place()`: depth `zr` from region hash ±0.5 plus id hash ±0.5, rotation `sin(t*0.13)*0.45` (0 with reduced motion or after `toggleSpin()` off), scale factor clamped 0.6–1.7. Draw order: background (sky/dust from `graphFx`, dimmer), edges grouped by colour (colour of source node; `link` edges brighter, others faint), nodes (sizes 70/25/5 % by `hash01(id)` + `min(1.2, sqrt(degree)*0.25)`, hubs larger; item-kind shapes as today), labels via `placeLabels` with obstacles = bounding rects of `.graph-search-wrap`, `.atlas`, `.graph-settings`, `.graph-card` elements inside the page, focus ring/ripple on selection, highlight dims non-matches to 0.15 alpha. Hit testing on projected positions; click selects, double-click opens. `fit()` frames all nodes with 10 % margin; `focusRegion` eases the camera to `regionCentres().get(name)`. Ambient drift below 3000 nodes; plain dots above 3500 unless zoom ≥ 2.
- [ ] **Step 4: Remove `galaxy.ts`** and any remaining import; `npx tsc --noEmit` exits 0.
- [ ] **Step 5: Run** `npx vitest run` — all pass.
- [ ] **Step 6: Add `scripts/graph-shots.mjs`** (Playwright): start from a dev server URL argument, create a seeded vault of N notes (argument) across 5 folders with links and tags, screenshot `#/graph` at 1400×900 and 390×844 in dark and light theme, and print for each: node count, settle time (ms until the canvas reports settled via `window.__graphSettledAt`, set only when `import.meta.env.DEV`), and the label-overlap count computed from `window.__graphLabels` (DEV only). Expected for N=50: overlap 0, settle < 1500 ms.
- [ ] **Step 7: Run** `node scripts/graph-shots.mjs http://localhost:5179 50` against `npx vite --port 5179`; view the screenshots: one round cloud, coloured lobes, no overlapping text. Fix and repeat until true.
- [ ] **Step 8: Commit** `feat(graph): round brain cloud replaces the galaxy; drop note-page mini graph`.

### Task 5: Atlas view

**Files:**
- Create: `src/ui/graphAtlas.ts`
- Modify: `src/ui/GraphCanvas.tsx` (when `view === 'atlas'`, delegate to the Atlas scene)
- Test: `src/ui/graphAtlas.test.ts`

**Interfaces:**
- Consumes: `GraphData` with `createdAt` on item nodes (Task 2), `regionOf`, `buildRegions` (Task 1), `placeLabels` (Task 3).
- Produces:

```ts
export interface AtlasOrb { region: string; label: string; hue: number; count: number; angle: number; x: number; y: number; radius: number; noteIds: string[] }
export function buildAtlasOrbs(data: GraphData, ring?: number): AtlasOrb[]   // ring default 300
export function fanOut(orb: AtlasOrb, nodes: Map<string, GraphNode>, limit?: number): { id: string; x: number; y: number }[]  // newest first, limit 150
export interface AtlasScene { draw(ctx: CanvasRenderingContext2D, time: number): void; pick(px: number, py: number): { kind: 'orb'; region: string } | { kind: 'note'; id: string } | null; focus(region: string | null): void; resize(w: number, h: number, dpr: number): void }
export function createAtlasScene(data: GraphData, opts: { reducedMotion: boolean; compact: boolean }): AtlasScene
```

- [ ] **Step 1: Write the failing tests:**

```ts
it('makes one orb per region, largest first, at most 12 with "Everything else"', ...)  // 15 regions → 12 orbs, last label 'Everything else'
it('spreads orbs evenly on the ring starting at the top', () => { /* angle[0] === -PI/2, equal spacing */ })
it('sizes orbs by note count', ...)        // radius 12 + 20*sqrt(count/biggest)
it('fans out the newest notes first, at most 150', ...)
it('works with a single region and with no notes', ...)
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** by porting `dashboard-graph-atlas.js`: orbs on a ring (reach `ring*(0.92+0.16*hash)`), satellites (`min(14, 3 + round(sqrt(count)))`), spokes to a golden dust cloud (Gaussian spread `ring*0.1`, colours `#ffd98a #ffc766 #fff1c9 #f2b84b`, sampled above 2200 notes), orb colour from `regionHue`, fly-in camera on focus, fan of newest notes around the focused orb, Back by clicking empty space or Esc (GraphView's Esc already deselects; when nothing is selected Esc calls `focusRegion('')` to go back). Labels through `placeLabels`.
- [ ] **Step 4: Wire into `GraphCanvas`**: `view === 'atlas'` draws the scene; `focusRegion(name)` calls `scene.focus(name)`; clicking a fanned note calls `onSelect(id)`, double-click `onOpen`.
- [ ] **Step 5: Run** `npx vitest run` — all pass; `npx tsc --noEmit` exits 0.
- [ ] **Step 6: Commit** `feat(graph): Atlas view with region orbs`.

### Task 6: Graph page controls

**Files:**
- Modify: `src/ui/GraphView.tsx`, `src/ui/glass.css` (switch styling), `src/ui/styles.css` only if needed
- Test: extend `scripts/graph-shots.mjs` checks

**Interfaces:**
- Consumes: `GraphCanvas` `view` prop, `GraphHandle.focusRegion`.
- Produces: localStorage key `mv.graph.view` with `'cloud' | 'atlas'`.

- [ ] **Step 1:** Add a segmented **Cloud / Atlas** switch at the top of the graph page (next to the search), state initialised from `localStorage['mv.graph.view']` (default `'cloud'`), persisted on change, passed as `view` to `GraphCanvas`.
- [ ] **Step 2:** When the route has `focus` (`#/graph?focus=<id>`), start in `'cloud'` regardless of the stored value and do not overwrite the stored value.
- [ ] **Step 3:** The region list keeps its own open/closed state (`atlasOpen`); rename its header to "Regions" so it isn't confused with the Atlas view; clicking a region calls `handle.current?.focusRegion(name)` in either view. Update the legend text ("Color = region…") to describe the cloud.
- [ ] **Step 4:** Extend `scripts/graph-shots.mjs`: click the switch to Atlas and screenshot; reload and confirm Atlas is still selected; open `#/graph?focus=<id>` and confirm Cloud is shown.
- [ ] **Step 5: Run** `npx vitest run` and `npm run build` (exit 0), then the shots script; inspect.
- [ ] **Step 6: Commit** `feat(graph): Cloud/Atlas switch, remembered per device`.

### Task 7: Verification, docs and version

**Files:**
- Modify: `KNOWN_GAPS.md`, `docs/FEATURES.md` (Graph section), `package.json`, `package-lock.json`, `android/app/build.gradle` (0.3.19, versionCode 19)

- [ ] **Step 1: Run** `node scripts/graph-shots.mjs http://localhost:5179 2000`. Expected at 390×844: settle < 3000 ms, label overlaps 0. If settle is slower, tune decay or move the layout to a worker (spec leaves this open) and re-run.
- [ ] **Step 2:** Review the 50-note and 2000-note screenshots in both themes and both views against the spec's goals and anti-goals; fix what fails.
- [ ] **Step 3:** Update `docs/FEATURES.md` (Graph: Cloud and Atlas, region colours stable, no mini graph on notes) and `KNOWN_GAPS.md` (what was verified, at which sizes; what wasn't, e.g. a real phone).
- [ ] **Step 4:** Bump the version to 0.3.19 (versionCode 19).
- [ ] **Step 5: Run** `npm test` and `npm run build`; both exit 0.
- [ ] **Step 6: Commit** `chore: graph cloud docs and 0.3.19`, push, update PR #4's description with what changed and how it was tested.
