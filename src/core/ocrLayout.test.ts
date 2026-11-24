import { describe, expect, it } from 'vitest'
import { layoutOcr, type OcrWord } from './ocrLayout'
import twoColumn from './__fixtures__/ocr-two-column.json'
import doc from './__fixtures__/ocr-document.json'

// Fixtures are real Tesseract (sparse mode) output for test screenshots: an article with a sidebar,
// and a single-column document with a heading, two paragraphs and a numbered list.

const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 95): OcrWord => ({ text, confidence, bbox: { x0, y0, x1, y1 } })

describe('layoutOcr on a two-column screenshot', () => {
  const md = layoutOcr(twoColumn as OcrWord[])

  it('reads the article column before the sidebar instead of interleaving them', () => {
    expect(md).toContain('which makes recall harder and therefore stronger.')
    expect(md).not.toMatch(/stronger\.\s*Active recall/)
    expect(md).not.toMatch(/week\.\s*Interleaving/)
    expect(md.indexOf('Double the gap')).toBeLessThan(md.indexOf('Related'))
  })

  it('joins wrapped lines into one paragraph and separates paragraphs', () => {
    expect(md).toContain('Each review comes just before you would forget')
    expect(md).toMatch(/stronger\.\n\nCramming feels productive/)
  })

  it('marks headings by text size', () => {
    expect(md).toMatch(/^# Spaced repetition beats cramming$/m)
    expect(md).toMatch(/^## How to start$/m)
  })

  it('turns bullet glyphs into a Markdown list', () => {
    expect(md).toMatch(/^- Write one question per idea\.\n- Review new cards the next day\.\n- Double the gap after every correct answer\.$/m)
    expect(md).not.toMatch(/[«+] (Write|Review|Double)/)
  })

  it('keeps sidebar items as separate lines', () => {
    expect(md).toMatch(/Related\n\nThe forgetting curve\n\nActive recall\n\nInterleaving practice/)
  })
})

describe('layoutOcr on a single-column document', () => {
  const md = layoutOcr(doc as OcrWord[])

  it('keeps the heading, both paragraphs and the numbered list in order', () => {
    expect(md).toMatch(/^#{1,2} Meeting notes$/m)
    expect(md).toMatch(/real users first\. Marketing wil{1,2} prepare the announcement in the meantime\.\n\nOpen questions remain/)
    expect(md).toMatch(/^1\. Finish the onboarding prototype.\n2\. Book five user interviews\.\n3\. Draft the pricing page\.$/m)
  })
})

describe('layoutOcr details', () => {
  it('joins a word split by a hyphen at the end of a line', () => {
    const md = layoutOcr([w('This', 0, 0, 40, 12), w('exam-', 45, 0, 90, 12), w('ple', 0, 18, 25, 30), w('works.', 30, 18, 80, 30)])
    expect(md).toBe('This example works.')
  })

  it('drops low-confidence noise that is not a bullet', () => {
    const md = layoutOcr([w('~j', 0, 0, 10, 12, 20), w('Hello', 20, 0, 60, 12), w('world', 65, 0, 110, 12)])
    expect(md).toBe('Hello world')
  })

  it('escapes text that would otherwise turn into Markdown', () => {
    const md = layoutOcr([w('#1', 0, 0, 20, 12), w('priority', 25, 0, 90, 12)])
    expect(md).toBe('\\#1 priority')
  })

  it('returns an empty string when nothing was read', () => {
    expect(layoutOcr([])).toBe('')
  })
})
