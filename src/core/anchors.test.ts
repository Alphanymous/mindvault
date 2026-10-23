// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyHighlights, clearHighlights, rangeOffsets, resolveOffsets } from './anchors'
import type { Annotation } from './types'

const ann = (id: string, text: string, start: number, color: Annotation['color'] = 'yellow'): Annotation => ({ id, text, start, end: start + text.length, color, createdAt: 1 })

let root: HTMLElement
beforeEach(() => {
  document.body.innerHTML = '<div id="r"><h1>Title here</h1><p>The quick <strong>brown fox</strong> jumps over the lazy dog.</p></div>'
  root = document.getElementById('r')!
})

describe('anchors', () => {
  it('computes offsets of a selection across elements', () => {
    const range = document.createRange()
    const strong = root.querySelector('strong')!.firstChild!
    range.setStart(root.querySelector('p')!.firstChild!, 4) // "quick "
    range.setEnd(strong, 5) // "brown"
    const o = rangeOffsets(root, range)!
    expect(o.text).toBe('quick brown')
    expect(root.textContent!.slice(o.start, o.end)).toBe('quick brown')
  })

  it('rejects ranges outside the root and empty selections', () => {
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.appendChild(outside)
    const r = document.createRange()
    r.selectNodeContents(outside)
    expect(rangeOffsets(root, r)).toBeNull()
    const empty = document.createRange()
    empty.setStart(root.querySelector('p')!.firstChild!, 1)
    empty.setEnd(root.querySelector('p')!.firstChild!, 1)
    expect(rangeOffsets(root, empty)).toBeNull()
  })

  it('wraps highlights, including text spanning inline elements, without changing the text', () => {
    const before = root.textContent
    const text = 'quick brown fox'
    const start = before!.indexOf(text)
    const missing = applyHighlights(root, [ann('a1', text, start, 'green'), ann('a2', 'lazy dog', before!.indexOf('lazy dog'), 'pink')])
    expect(missing).toEqual([])
    expect(root.textContent).toBe(before)
    const marks = [...root.querySelectorAll('mark[data-ann="a1"]')]
    expect(marks.length).toBeGreaterThanOrEqual(2) // split around <strong>
    expect(marks.map((m) => m.textContent).join('')).toBe(text)
    expect(root.querySelector('mark.hl-pink')!.textContent).toBe('lazy dog')
  })

  it('re-anchors by quote when offsets drifted, and reports lost highlights', () => {
    const text = root.textContent!
    expect(resolveOffsets(text, { text: 'lazy dog', start: 3, end: 11 })).toEqual({ start: text.indexOf('lazy dog'), end: text.indexOf('lazy dog') + 8 })
    expect(resolveOffsets(text, { text: 'not present', start: 0, end: 11 })).toBeNull()
    expect(applyHighlights(root, [ann('lost', 'not present', 0)])).toEqual(['lost'])
  })

  it('clearHighlights restores the original DOM text and is idempotent', () => {
    const text = root.textContent!
    applyHighlights(root, [ann('a', 'brown fox', text.indexOf('brown fox'))])
    clearHighlights(root)
    expect(root.querySelector('mark')).toBeNull()
    expect(root.textContent).toBe(text)
    applyHighlights(root, [ann('a', 'brown fox', text.indexOf('brown fox'))])
    applyHighlights(root, [ann('a', 'brown fox', text.indexOf('brown fox'))])
    expect(root.querySelectorAll('mark[data-ann="a"]').length).toBeGreaterThanOrEqual(1)
    expect([...root.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe('brown fox')
  })
})
