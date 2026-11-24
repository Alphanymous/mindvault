# Graph: from spinning galaxy to EleSync-style brain cloud

Date: 2026-11-24 · Status: draft for Santo's approval

## Intent

Santo opens the graph mostly to look at it: it should be eye candy and, at the same time, beautiful and well
organized. Today it isn't: the layout is a wide spinning disc with long spokes, regions sit far apart, and
labels collide (note names over region names, piles of labels in the small note-page graph). He wants it
compact and round, "like a big round brain", with the connecting lines kept, and he points to the graph in
his other project, EleSync (`darknodebros/elesync`, `elesync/static/dashboard-graph*.js`), as "damn near
perfect", including its Atlas view, which switches the whole scene to a different shape.

## Goals

- One compact, round glowing cloud of notes, the same character as EleSync's "cloud" view.
- Connections stay visible and readable; lines take the colour of the region they come from, so neighbouring
  regions blend.
- Labels never pile up: few by default, more on focus or zoom, never on top of each other or of region names.
- An Atlas view like EleSync's: a separate scene with one glowing orb per region on a ring, satellites, a
  golden cloud of every note in the centre, and clicking an orb flies in and fans out that region's notes.
- Smooth on a mid-range Android phone and in the Windows app.

## Non-goals

- Changing what a region means. Regions stay top-level folders (`src/core/clusters.ts`), so colours match
  the Clusters page and the Atlas list. Link-based regions and suggested links are separate, later ideas.
- Changing how links, tags or folders are found (`buildGraph` in `src/core/links.ts` stays the data source).
- Keeping the old 3D galaxy as an option. Approach 1 replaces it.

## Anti-goals (a failure even if it works)

- A cloud that is still stretched or lopsided, or that slowly drifts apart.
- Region colours or positions that jump around every time the graph opens or a note is added.
- Labels overlapping anything.
- A graph that stutters on the phone.

## Constraints

- React 19 + TypeScript, canvas 2D rendering (as today); no new graphics libraries.
- Two call sites must keep working with the same props: `GraphView.tsx` (full page, with `GraphHandle`:
  `zoomBy`, `fit`, `focusSelected`, `toggleSpin`, `focusRegion`) and `Home.tsx` (compact preview).
- **The small local graph on each note page is removed** (Santo: "the notes graph is not necessary"). The
  note page keeps its "Open in graph" button, which opens the full graph focused on that note
  (`#/graph?focus=<id>`, already supported).
- Must keep: search highlight (`highlight` set dims the rest), select on click, open on double click / Enter,
  hover, keyboard (F show everything, Tab next connection, Enter open, Esc let go), `prefers-reduced-motion`,
  light and dark themes, item-kind shapes (dot note, ring web page, double ring PDF, cross prompt, square file).
- Graph settings panel keeps its toggles (Tags, Folders, Unwritten links, Hide unconnected, kinds).
- EleSync is plain JavaScript in a Python app; its code is a reference to port, not a dependency.

## Approaches considered

1. **Port EleSync's cloud and Atlas into Mindvault (chosen by Santo).** Rewrite EleSync's flat force layout
   (Barnes-Hut repulsion with 1/distance falloff, degree-scaled springs, even round gravity), its fake-3D sway,
   its colour and label rules and its Atlas scene in TypeScript, wired to Mindvault's data and call sites.
   Proven look; biggest change; replaces the galaxy.
2. Retune the existing 3D galaxy (thickness to a ball, no swirl, tighter springs) and copy EleSync's label
   rules and Atlas. Less code, but the engine underneath differs, so it may never look like EleSync.
3. Share one graph module between both apps. Different stacks (vanilla JS vs React/TS); not worth it now.

## Design

### Views and switching

- Two views: **Cloud** (default) and **Atlas**. A clear Cloud / Atlas switch on the graph page changes the
  whole scene, as in EleSync; the choice is remembered on the device (localStorage).
- The existing region list stays. In Cloud, picking a region flies to its patch and stays in Cloud; in Atlas,
  it focuses that region's orb. The list's open/closed state is separate from the view.

### Layout (`src/core/cloudLayout.ts`, pure, testable in Node)

Port of `dashboard-graph-layout.js`: 2D positions, Barnes-Hut quadtree repulsion (θ² = 0.81), springs whose
pull and rest length scale with node degree, soft centre gravity (stronger for unconnected nodes), velocity
damping, cooling (`alpha`) until settled, `reheat()` on data change. Seeded per region on a golden-angle
spiral (as EleSync's `seed()`). Deterministic randomness from node ids (Mindvault already has `hash01`).

- **Regions always hold together as lobes.** Beyond EleSync, a weak pull toward each region's own anchor point
  keeps its notes together even when Folders is off, notes are unfiled, or there are few `[[links]]`. Without
  it, unconnected notes collapse into one mixed ball and "a region's patch" stops existing.
- **Region anchors are fixed by region name** (deterministic angle on the spiral), so each region lands in
  roughly the same place on every opening and after notes are added. Within one session, positions carry over
  when data changes (warm start, as the galaxy does today). Individual notes may shift slightly between
  visits; positions are not saved to storage.

### Look (`src/ui/GraphCanvas.tsx`, rewritten)

- **Depth sway**: every node gets a depth from its region plus its own id; the cloud turns ±0.45 rad slowly;
  nearer nodes draw larger. Off with reduced motion.
- **Colour**: each region's colour is derived from its name (a hash into Mindvault's palette), not from its
  place in an alphabetical list, so a new folder never recolours the others. Colours are computed from all
  live notes, never from the filtered graph. `src/core/clusters.ts` changes accordingly and the Clusters page
  and Atlas list use the same function, so colours match everywhere;
  links and spokes take the colour of the node they leave from; direct `[[links]]` drawn slightly brighter.
- **Sizes**: most notes small dots, some medium, a few large (EleSync's 70/25/5 split), plus a bit by degree;
  folder and tag hubs larger. Item-kind shapes kept.
- **Ambient life**: small drift and occasional travelling pulses along links below ~3000 nodes (EleSync's
  thresholds); plain dots above ~3500 nodes until zoomed in.
- **Background**: keep Mindvault's sky, dust and soft glow from `graphFx.ts`, toned down so the cloud is the
  focus.

### Labels

- Default: region names and the 5 busiest notes only. On hover/select: the focused note and up to 14 of its
  neighbours. Zoomed in past a threshold: up to 60 visible notes.
- Every label (note names, region names, hub names) goes through one collision check against labels already
  placed and against the screen edges and floating panels; a label that doesn't fit is skipped, highest
  priority first. Labels flip to the other side of their dot near the right edge (as EleSync).
- Compact mode (Home preview): region names off; the selected note always labelled; at most 6
  other labels.

### Atlas (`src/ui/graphAtlas.ts`, used by GraphCanvas)

Port of `dashboard-graph-atlas.js`: one orb per region (max 12, the rest grouped as "Everything else") on a
ring, orb size by note count, satellites circling, thin spokes to a golden central cloud of every note
(sampled above 2200). Clicking an orb flies in and fans out up to 150 of its newest notes; click a note to
select, double-click to open; Back returns. The existing Atlas button and list in `GraphView` switch the
canvas between "Cloud" and "Atlas"; picking a region in the list focuses that orb.

### Behaviour kept

`GraphHandle` methods keep their names: `focusRegion` flies to a region's patch (Cloud) or orb (Atlas);
`toggleSpin` turns the sway on/off; `fit` frames the whole cloud.

## Left to the builder

- Exact constants (repulsion, spring distance, gravity, sway speed) tuned against a 50-note and a 2000-note
  test vault until the cloud is round and settles in under ~3 seconds.
- Whether the layout runs on the main thread or a worker (main thread is fine if it stays smooth).
- How the old `galaxy.ts` is retired (delete once nothing imports it).
- Test strategy: unit tests for the layout (roundness, stability across runs, no NaN, settles) and label
  placement (no overlaps); screenshot checks in Playwright at desktop and phone sizes, both themes.

## Calls I made (not discussed with Santo)

- Regions stay folders; colours stay Mindvault's palette rather than EleSync's neon palette.
- Region colour comes from the folder name, so colours never shift when folders are added (touches the
  Clusters page too).
- Regions are held together as lobes even without links (a small addition to EleSync's layout).
- Cloud is the default view; Atlas is a switch, remembered per device.
- Region positions are stable; individual note positions may vary slightly between visits.
- Tags stay hidden by default in the full graph (as today); when shown they're labelled hubs like EleSync's.
- The galaxy is removed, not kept as an option.
