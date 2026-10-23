import { describe, expect, it } from 'vitest'
import { parseShared } from './shared'

describe('parseShared', () => {
  it('treats a bare link as a web clip', () => {
    expect(parseShared({ text: 'https://example.com/post' })).toEqual({ kind: 'url', url: 'https://example.com/post', title: undefined })
  })
  it('uses the url field first and keeps the title', () => {
    expect(parseShared({ url: 'https://a.com', title: 'Great page', text: 'ignored' })).toEqual({ kind: 'url', url: 'https://a.com', title: 'Great page' })
  })
  it('splits "Headline link" shares into title and url', () => {
    expect(parseShared({ text: 'Why local-first wins https://x.org/essay' })).toEqual({ kind: 'url', url: 'https://x.org/essay', title: 'Why local-first wins' })
  })
  it('keeps long text with an incidental link as a note', () => {
    const text = 'Remember to read this later.\n\nIt matters because of many reasons that go on.\n\nhttps://x.org/a'
    expect(parseShared({ text })).toEqual({ kind: 'text', text, title: undefined })
  })
  it('drops trailing punctuation from a link', () => {
    expect(parseShared({ text: 'see https://x.org/a.' })).toMatchObject({ kind: 'url', url: 'https://x.org/a' })
  })
  it('falls back to the subject when text is empty, and to null when nothing is there', () => {
    expect(parseShared({ title: 'Buy milk' })).toEqual({ kind: 'text', text: 'Buy milk', title: undefined })
    expect(parseShared({})).toBeNull()
    expect(parseShared({ text: '   ' })).toBeNull()
  })
})
