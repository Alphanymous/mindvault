import { describe, expect, it } from 'vitest'
import { captureSignals, mentionExcerpt, readingMinutes, wordCount } from './noteStats'

describe('wordCount', () => {
  it('counts words and ignores markdown symbols, link brackets and code fences', () => {
    expect(wordCount('# Title\n\nHello **bold** world, see [[Other note|alias]].')).toBe(6)
    expect(wordCount('```ts\nconst x = 1\n```\nTwo words')).toBe(2)
    expect(wordCount('')).toBe(0)
    expect(wordCount('- [ ] task one\n- [x] task two')).toBe(4)
  })

  it('skips frontmatter', () => {
    expect(wordCount('---\ntitle: x\ntags: [a]\n---\nOnly these three')).toBe(3)
  })
})

describe('readingMinutes', () => {
  it('rounds to whole minutes and never shows less than one', () => {
    expect(readingMinutes(0)).toBe(1)
    expect(readingMinutes(100)).toBe(1)
    expect(readingMinutes(460)).toBe(2)
    expect(readingMinutes(1248)).toBe(5)
  })
})

describe('mentionExcerpt', () => {
  it('returns the line that links to the title, with link brackets turned into plain words', () => {
    const src = '# Notes\n\nFirst line.\nFeedback loops keep [[Cognitive Architecture]] stable over time.\nLast.'
    expect(mentionExcerpt(src, 'Cognitive Architecture')).toBe('Feedback loops keep Cognitive Architecture stable over time.')
  })

  it('matches case-insensitively, through aliases and heading anchors', () => {
    expect(mentionExcerpt('See [[cognitive architecture#Intro|the map]] here', 'Cognitive Architecture')).toBe('See the map here')
  })

  it('trims long lines around the link and strips list and quote markers', () => {
    const long = `> - ${'word '.repeat(60)}[[Target]] ${'tail '.repeat(60)}`
    const out = mentionExcerpt(long, 'Target', 80)!
    expect(out.length).toBeLessThanOrEqual(82)
    expect(out).toContain('Target')
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns null when the note does not link to the title', () => {
    expect(mentionExcerpt('Nothing here about it', 'Target')).toBeNull()
  })
})

describe('captureSignals', () => {
  it('counts words, characters, wikilinks, tags and web links in a capture', () => {
    const s = captureSignals('Link [[A]] and [[B]] with #heuristics, see https://example.com')
    expect(s).toEqual({ words: 8, chars: 62, links: ['A', 'B'], tags: ['heuristics'], urls: 1 })
  })

  it('reports nothing for empty text', () => {
    expect(captureSignals('   ')).toEqual({ words: 0, chars: 0, links: [], tags: [], urls: 0 })
  })
})
