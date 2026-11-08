/**
 * Decorates rendered Markdown in place: code block chrome (language + copy button) and Obsidian-style callouts.
 * It never adds or removes text, only wraps it, so highlight offsets (core/anchors) stay valid.
 */
import { copyText } from './util'

const CALLOUT = /^\[!(\w+)\][+-]?/

function decorateCode(root: HTMLElement) {
  root.querySelectorAll<HTMLPreElement>('pre:not([data-chrome])').forEach((pre) => {
    pre.dataset.chrome = '1'
    const lang = /language-([\w+#-]+)/.exec(pre.querySelector('code')?.className ?? '')?.[1]
    pre.dataset.lang = lang ?? 'text'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'code-copy'
    copy.setAttribute('aria-label', 'Copy code')
    copy.title = 'Copy'
    pre.prepend(copy)
  })
}

function decorateCallouts(root: HTMLElement) {
  root.querySelectorAll<HTMLQuoteElement>('blockquote:not([data-callout])').forEach((bq) => {
    const first = bq.querySelector('p')?.firstChild
    if (!(first instanceof Text)) return
    const m = CALLOUT.exec(first.data)
    if (!m) return
    bq.dataset.callout = m[1].toLowerCase()
    bq.classList.add('callout')
    // Wrap the "[!tip]" marker (hidden by CSS) and the rest of the first line (the title) without changing the text.
    const marker = first.splitText(m[0].length).previousSibling as Text
    const markerSpan = document.createElement('span')
    markerSpan.className = 'callout-marker'
    marker.replaceWith(markerSpan)
    markerSpan.append(marker)
    const rest = markerSpan.nextSibling
    if (rest instanceof Text && rest.data.trim()) {
      const title = document.createElement('span')
      title.className = 'callout-title'
      rest.replaceWith(title)
      title.append(rest)
    }
  })
}

export function enhanceProse(root: HTMLElement | null) {
  if (!root) return
  decorateCode(root)
  decorateCallouts(root)
}

/** Copies the code of the block whose copy button was clicked. */
export async function handleCodeCopy(target: HTMLElement): Promise<void> {
  const btn = target.closest<HTMLButtonElement>('.code-copy')
  if (!btn) return
  const text = btn.parentElement?.querySelector('code')?.textContent ?? ''
  const state = (await copyText(text)) ? 'done' : 'failed'
  btn.classList.add(state)
  btn.setAttribute('aria-label', state === 'done' ? 'Copied' : 'Copy blocked')
  setTimeout(() => {
    btn.classList.remove(state)
    btn.setAttribute('aria-label', 'Copy code')
  }, 1400)
}
