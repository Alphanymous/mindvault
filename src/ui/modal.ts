import { useLayoutEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** Controls inside root that Tab can reach, in document order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.tabIndex < 0 || el.closest('[hidden], [inert]')) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

/** Keeps Tab and Shift+Tab cycling inside root. */
export function trapTab(root: HTMLElement, e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const list = focusables(root)
  if (!list.length) return
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement as HTMLElement | null
  const outside = !active || !root.contains(active)
  if (outside) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

/** How many open modals hold each element inert, so stacked dialogs lift it only when the last one closes. */
const inertHolds = new WeakMap<Element, number>()

/**
 * Turns an overlay into a real modal: everything beside it becomes inert (live regions stay so
 * toasts are still announced), and closing hands focus back to whatever opened it.
 * Returns the cleanup.
 */
export function activateModal(overlay: HTMLElement): () => void {
  const opener = document.activeElement as HTMLElement | null
  const parent = overlay.parentElement
  const held: Element[] = []
  if (parent) {
    for (const el of parent.children) {
      if (el === overlay || el.matches('[aria-live]')) continue
      const count = inertHolds.get(el) ?? 0
      // inert set by something other than a modal is not ours to lift
      if (count === 0 && el.hasAttribute('inert')) continue
      inertHolds.set(el, count + 1)
      el.setAttribute('inert', '')
      held.push(el)
    }
  }
  return () => {
    for (const el of held) {
      const count = (inertHolds.get(el) ?? 1) - 1
      if (count > 0) {
        inertHolds.set(el, count)
      } else {
        inertHolds.delete(el)
        el.removeAttribute('inert')
      }
    }
    if (opener?.isConnected) opener.focus()
  }
}

/**
 * React wrapper: makes the overlay modal and traps Tab inside the dialog while it is mounted.
 * A layout effect, so on close the page is live again and focus is back on the opener before
 * anything mounted in the same commit (an editor with autoFocus, say) takes focus.
 */
export function useModal(overlay: RefObject<HTMLElement | null>, dialog: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const o = overlay.current
    const d = dialog.current
    if (!o || !d) return
    const release = activateModal(o)
    // dialogs that do not focus a field themselves still take focus off the now-inert page
    if (!d.contains(document.activeElement)) focusables(d)[0]?.focus()
    const onKey = (e: KeyboardEvent) => trapTab(d, e)
    d.addEventListener('keydown', onKey)
    return () => {
      d.removeEventListener('keydown', onKey)
      release()
    }
  }, [overlay, dialog])
}
