// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphData, GraphNode } from '../core/types'
import { GraphCanvas, type GraphHandle } from './GraphCanvas'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A 2D context that accepts every call and records method names, enough for the renderer to run. */
function fakeContext(calls: string[]) {
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * 6 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key]
      return (..._args: unknown[]) => {
        calls.push(key)
      }
    },
    set(t, key: string, value) {
      t[key] = value
      return true
    },
  })
}

/** Frames run only when the test asks, so a throw in the draw code fails the test. */
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
let clock = 0
function flush(count: number) {
  for (let i = 0; i < count; i++) {
    const due = [...frames.values()]
    frames = new Map()
    clock += 33
    for (const cb of due) cb(clock)
  }
}

let reduced = false
const calls: string[] = []

beforeEach(() => {
  reduced = false
  calls.length = 0
  frames = new Map()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext(calls) as unknown as CanvasRenderingContext2D)
  // jsdom has no layout: give the canvas a desktop-sized box
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600, toJSON() {} }) as DOMRect)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') && reduced, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  delete (window as { __graphSettledAt?: number }).__graphSettledAt
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const FOLDERS = ['Research', 'Projects', 'Journal', 'Reading', 'Ideas']
function vault(count: number): GraphData {
  const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `Note number ${i} about ${FOLDERS[i % 5].toLowerCase()}`,
    kind: 'item',
    itemType: (['note', 'web', 'pdf', 'prompt', 'file'] as const)[i % 5],
    degree: 0,
    folder: FOLDERS[i % 5],
    createdAt: i,
  }))
  const edges: GraphData['edges'] = []
  for (let i = 5; i < count; i++) edges.push({ source: `n${i}`, target: `n${i - 5}`, kind: 'link' })
  for (const e of edges) {
    nodes.find((n) => n.id === e.source)!.degree++
    nodes.find((n) => n.id === e.target)!.degree++
  }
  return { nodes, edges }
}

function mount(data: GraphData, extra: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  const ref = createRef<GraphHandle>()
  act(() => root.render(createElement(GraphCanvas, { ref, data, selectedId: null, onSelect: () => {}, onOpen: () => {}, ...extra })))
  return { ref, root, host }
}

describe('GraphCanvas (cloud)', () => {
  it.each([0, 1, 50])('renders %i nodes and draws frames without throwing', (count) => {
    const { root } = mount(vault(count))
    expect(() => act(() => flush(30))).not.toThrow()
    act(() => root.unmount())
  })

  it('handle methods work, and toggleSpin flips the sway off then on', () => {
    const { ref, root } = mount(vault(50))
    act(() => flush(5))
    const h = ref.current!
    expect(() => {
      h.fit()
      h.zoomBy(1.2)
      h.focusRegion('Research')
      h.focusSelected()
      act(() => flush(5))
    }).not.toThrow()
    expect(h.toggleSpin()).toBe(false)
    expect(h.toggleSpin()).toBe(true)
    act(() => root.unmount())
  })

  it('settles, reports it in dev, and places labels that never overlap', () => {
    const { root } = mount(vault(50), { selectedId: 'n7' })
    act(() => flush(120))
    const w = window as { __graphSettledAt?: number; __graphLabels?: { box: { x: number; y: number; w: number; h: number } }[] }
    expect(typeof w.__graphSettledAt).toBe('number')
    const boxes = (w.__graphLabels ?? []).map((l) => l.box)
    expect(boxes.length).toBeGreaterThan(0)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
      }
    act(() => root.unmount())
  })

  it('with reduced motion, stops asking for frames once settled and idle', () => {
    reduced = true
    const { root } = mount(vault(50))
    act(() => flush(60))
    expect(frames.size).toBe(0)
    act(() => root.unmount())
  })

  it('accepts the atlas view (renders the cloud until Atlas lands)', () => {
    const { root } = mount(vault(10), { view: 'atlas' })
    expect(() => act(() => flush(10))).not.toThrow()
    act(() => root.unmount())
  })
})
