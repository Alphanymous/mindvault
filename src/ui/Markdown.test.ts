// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './Markdown'

describe('renderMarkdown', () => {
  it('keeps task list items as read-only checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo', () => null)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const boxes = [...doc.querySelectorAll('input')]
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.type === 'checkbox' && b.disabled)).toBe(true)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
  })

  const parse = (md: string) => new DOMParser().parseFromString(renderMarkdown(md, () => null), 'text/html')

  it('keeps table column alignment', () => {
    const cells = [...parse('| a | b | c |\n|:-|:-:|--:|\n| 1 | 2 | 3 |').querySelectorAll('td')]
    expect(cells.map((c) => c.getAttribute('align'))).toEqual(['left', 'center', 'right'])
  })

  it('keeps the start number of an ordered list', () => {
    expect(parse('3. three\n4. four').querySelector('ol')?.getAttribute('start')).toBe('3')
  })

  it('keeps image size, language and direction attributes', () => {
    const doc = parse('<img src="https://x.test/a.png" width="120" height="80"> <p lang="ar" dir="rtl">سلام</p>')
    expect(doc.querySelector('img')?.getAttribute('width')).toBe('120')
    expect(doc.querySelector('img')?.getAttribute('height')).toBe('80')
    expect(doc.querySelector('p[lang]')?.getAttribute('dir')).toBe('rtl')
  })

  it('still strips unsafe URLs', () => {
    const doc = parse('[x](javascript:alert(1)) <img src="javascript:alert(1)"> <a href="data:text/html,hi">d</a>')
    for (const el of doc.querySelectorAll('a, img')) {
      expect(el.getAttribute('href') ?? el.getAttribute('src') ?? '').not.toMatch(/javascript:|data:/i)
    }
  })

  it('turns raw inputs into read-only checkboxes', () => {
    const input = parse('<input type="password">').querySelector('input')
    expect(input?.type).toBe('checkbox')
    expect(input?.disabled).toBe(true)
  })
})
