import { describe, expect, it } from 'vitest'
import { applyFormat } from './format'

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
})
