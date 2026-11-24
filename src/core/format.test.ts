import { describe, expect, it } from 'vitest'
import { applyFormat, diffEdit } from './format'

describe('applyFormat', () => {
  it('wraps the selection in bold, italic, code and wikilink marks and keeps it selected', () => {
    expect(applyFormat('say hi now', 4, 6, 'bold')).toEqual({ value: 'say **hi** now', start: 6, end: 8 })
    expect(applyFormat('say hi now', 4, 6, 'italic')).toEqual({ value: 'say _hi_ now', start: 5, end: 7 })
    expect(applyFormat('say hi now', 4, 6, 'code')).toEqual({ value: 'say `hi` now', start: 5, end: 7 })
    expect(applyFormat('say hi now', 4, 6, 'wikilink')).toEqual({ value: 'say [[hi]] now', start: 6, end: 8 })
  })

  it('puts the cursor between empty marks when nothing is selected', () => {
    expect(applyFormat('ab', 1, 1, 'wikilink')).toEqual({ value: 'a[[]]b', start: 3, end: 3 })
  })

  it('fences multi-line code', () => {
    expect(applyFormat('x\ny', 0, 3, 'code').value).toBe('```\nx\ny\n```')
  })

  it('prefixes the current line for headings and tasks, toggling them off when already there', () => {
    expect(applyFormat('one\ntwo', 5, 5, 'heading')).toEqual({ value: 'one\n## two', start: 8, end: 8 })
    expect(applyFormat('one\n## two', 8, 8, 'heading')).toEqual({ value: 'one\ntwo', start: 5, end: 5 })
    expect(applyFormat('buy milk', 0, 0, 'task')).toEqual({ value: '- [ ] buy milk', start: 6, end: 6 })
    expect(applyFormat('- [ ] buy milk', 8, 8, 'task')).toEqual({ value: 'buy milk', start: 2, end: 2 })
  })

  it('inserts a # for a tag, with a space before it when needed', () => {
    expect(applyFormat('word', 4, 4, 'tag')).toEqual({ value: 'word #', start: 6, end: 6 })
    expect(applyFormat('', 0, 0, 'tag')).toEqual({ value: '#', start: 1, end: 1 })
  })

  it('turns a selection into a tag instead of deleting it', () => {
    expect(applyFormat('I like heuristics a lot', 7, 17, 'tag')).toEqual({ value: 'I like #heuristics a lot', start: 18, end: 18 })
    expect(applyFormat('try deep work today', 4, 13, 'tag')).toEqual({ value: 'try #deep-work today', start: 14, end: 14 })
  })

  it('keeps whitespace around a tagged selection and does not double the #', () => {
    expect(applyFormat('a idea b', 2, 7, 'tag')).toEqual({ value: 'a #idea b', start: 7, end: 7 })
    expect(applyFormat('see #idea', 4, 9, 'tag')).toEqual({ value: 'see #idea', start: 9, end: 9 })
    expect(applyFormat('xidea', 1, 5, 'tag')).toEqual({ value: 'x #idea', start: 7, end: 7 })
  })

  it('never loses selected text that cannot become a tag', () => {
    expect(applyFormat('a 2024 b', 2, 6, 'tag').value).toBe('a #2024 b')
    expect(applyFormat('a !!! b', 2, 5, 'tag').value).toBe('a #!!! b')
  })
})

describe('diffEdit', () => {
  it('finds the smallest replaced range between two texts', () => {
    expect(diffEdit('say hi now', 'say **hi** now')).toEqual({ from: 4, to: 6, text: '**hi**' })
    expect(diffEdit('one\n## two', 'one\ntwo')).toEqual({ from: 4, to: 7, text: '' })
    expect(diffEdit('abc', 'abc')).toBeNull()
    expect(diffEdit('', 'x')).toEqual({ from: 0, to: 0, text: 'x' })
  })

  it('produces a range that rebuilds the new text', () => {
    const cases: [string, string][] = [['aaa', 'aaaa'], ['I like heuristics', 'I like #heuristics'], ['xx', ''], ['ab', 'ba']]
    for (const [a, b] of cases) {
      const d = diffEdit(a, b)!
      expect(a.slice(0, d.from) + d.text + a.slice(d.to)).toBe(b)
    }
  })
})
