// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './Markdown'
import { enhanceProse } from './proseEnhance'

const render = (md: string) => {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(md, () => null)
  const text = root.textContent
  enhanceProse(root)
  expect(root.textContent).toBe(text) // highlight offsets depend on the text staying the same
  return root
}

describe('enhanceProse callouts', () => {
  it('turns a [!type] quote into a callout with its title', () => {
    const bq = render('> [!tip] Remember\n> body').querySelector('blockquote')!
    expect(bq.dataset.callout).toBe('tip')
    expect(bq.querySelector('.callout-title')?.textContent).toBe(' Remember')
  })

  it('gives a callout without a title a label from its type', () => {
    const title = render('> [!warning]\n> body').querySelector('.callout-title') as HTMLElement
    expect(title).not.toBeNull()
    expect(title.textContent).toBe('')
    expect(title.dataset.label).toBe('warning')
  })

  it('only treats the quote whose own first paragraph has the marker as the callout', () => {
    const root = render('> outer text\n>\n> > [!note] Inner')
    const [outer, inner] = [...root.querySelectorAll('blockquote')]
    expect(outer.classList.contains('callout')).toBe(false)
    expect(inner.dataset.callout).toBe('note')
  })

  it('does not style an outer quote from a nested callout', () => {
    const root = render('> > [!note] Inner')
    const [outer, inner] = [...root.querySelectorAll('blockquote')]
    expect(outer.classList.contains('callout')).toBe(false)
    expect(inner.dataset.callout).toBe('note')
  })
})
