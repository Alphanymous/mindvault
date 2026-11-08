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
})
