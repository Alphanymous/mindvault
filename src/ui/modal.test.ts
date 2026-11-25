// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { activateModal, trapTab } from './modal'

function setup() {
  document.body.innerHTML = `
    <div class="shell">
      <aside class="sidebar"><button id="opener">Open</button></aside>
      <main class="main"><a id="link" href="#x">Link</a></main>
      <div class="toasts" aria-live="polite"></div>
      <div class="overlay">
        <div role="dialog" id="dialog">
          <button id="first">First</button>
          <input id="field" />
          <button id="hidden-btn" hidden>Hidden</button>
          <button id="last">Last</button>
        </div>
      </div>
    </div>`
  const opener = document.getElementById('opener') as HTMLButtonElement
  const overlay = document.querySelector('.overlay') as HTMLElement
  const dialog = document.getElementById('dialog') as HTMLElement
  return { opener, overlay, dialog }
}

const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })

describe('activateModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('makes the page behind the dialog inert but keeps live regions announced', () => {
    const { overlay } = setup()
    activateModal(overlay)
    expect(document.querySelector('.sidebar')!.hasAttribute('inert')).toBe(true)
    expect(document.querySelector('.main')!.hasAttribute('inert')).toBe(true)
    expect(document.querySelector('.toasts')!.hasAttribute('inert')).toBe(false)
    expect(overlay.hasAttribute('inert')).toBe(false)
  })

  it('removes only the inert it added and returns focus to the opener on close', () => {
    const { opener, overlay } = setup()
    document.querySelector('.main')!.setAttribute('inert', '')
    opener.focus()
    const release = activateModal(overlay)
    ;(document.getElementById('field') as HTMLElement).focus()
    release()
    expect(document.querySelector('.sidebar')!.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('.main')!.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(opener)
  })

  it('keeps the page inert until the last of two stacked dialogs closes', () => {
    const { overlay } = setup()
    const second = document.createElement('div')
    overlay.parentElement!.appendChild(second)
    const releaseFirst = activateModal(overlay)
    const releaseSecond = activateModal(second)
    releaseFirst()
    expect(document.querySelector('.main')!.hasAttribute('inert')).toBe(true)
    releaseSecond()
    expect(document.querySelector('.main')!.hasAttribute('inert')).toBe(false)
  })

  it('does not throw when the opener is gone by the time the dialog closes', () => {
    const { opener, overlay } = setup()
    opener.focus()
    const release = activateModal(overlay)
    opener.remove()
    expect(() => release()).not.toThrow()
  })
})

describe('trapTab', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('wraps Tab from the last control to the first', () => {
    const { dialog } = setup()
    ;(document.getElementById('last') as HTMLElement).focus()
    const e = tab()
    trapTab(dialog, e)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first')
  })

  it('wraps Shift+Tab from the first control to the last, skipping hidden ones', () => {
    const { dialog } = setup()
    ;(document.getElementById('first') as HTMLElement).focus()
    const e = tab(true)
    trapTab(dialog, e)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('leaves Tab alone between controls in the middle', () => {
    const { dialog } = setup()
    ;(document.getElementById('first') as HTMLElement).focus()
    const e = tab()
    trapTab(dialog, e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('pulls focus back in when it sits outside the dialog', () => {
    const { dialog } = setup()
    ;(document.getElementById('link') as HTMLElement).focus()
    const e = tab()
    trapTab(dialog, e)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first')
  })
})
