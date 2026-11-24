// Pure label placement for the graph canvas: one collision check for every label
// (notes, regions, hubs) against placed labels, screen edges and floating panels.

export interface LabelRequest {
  id: string
  text: string
  x: number
  y: number
  dotRadius: number
  priority: number
  size: number
  kind: 'note' | 'region' | 'hub'
}

export interface PlacedLabel extends LabelRequest {
  box: { x: number; y: number; w: number; h: number }
  text: string
  side: 'right' | 'left'
}

interface Box { x: number; y: number; w: number; h: number }

const PAD = 3
const EDGE = 6

function intersects(a: Box, b: Box, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}

export function placeLabels(
  requests: LabelRequest[],
  measure: (text: string, size: number) => number,
  bounds: { w: number; h: number },
  obstacles: Box[],
  maxChars = 44,
): PlacedLabel[] {
  const sorted = requests.slice().sort((a, b) => b.priority - a.priority)
  const placed: PlacedLabel[] = []
  for (const r of sorted) {
    const text = r.text.length > maxChars ? r.text.slice(0, maxChars - 1) + '…' : r.text
    const w = measure(text, r.size)
    const h = r.size + 2
    const gap = r.dotRadius * 1.2 + 6
    let side: 'right' | 'left' = 'right'
    let bx = r.x + gap
    if (bx + w > bounds.w - EDGE) {
      side = 'left'
      bx = r.x - gap - w
    }
    const box: Box = { x: bx, y: r.y - h / 2, w, h }
    if (box.x < 0 || box.y < 0 || box.x + w > bounds.w || box.y + h > bounds.h) continue
    let ok = true
    for (const o of obstacles) if (intersects(box, o, 0)) { ok = false; break }
    if (!ok) continue
    for (const p of placed) if (intersects(box, p.box, PAD)) { ok = false; break }
    if (!ok) continue
    placed.push({ ...r, text, box, side })
  }
  return placed
}
