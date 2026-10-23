/** Pure helpers for LAN pairing, validation of data received from another device, and the web clipper. */
import type { Item, ItemType } from '../core/types'

export const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/
const ITEM_TYPES: ItemType[] = ['note', 'pdf', 'web', 'prompt', 'file']
const MAX_CONTENT = 6_000_000

export const isValidId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s)

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Strict shape check for items arriving from a peer. Anything unexpected is rejected, never "fixed". */
export function isValidItem(x: unknown): x is Item {
  if (!x || typeof x !== 'object') return false
  const i = x as Record<string, unknown>
  if (!isValidId(i.id)) return false
  if (!isStr(i.type) || !ITEM_TYPES.includes(i.type as ItemType)) return false
  if (!isStr(i.title) || i.title.length > 500) return false
  if (!isStr(i.content) || i.content.length > MAX_CONTENT) return false
  if (!isStr(i.folder) || i.folder.length > 300) return false
  if (!Array.isArray(i.tags) || i.tags.length > 100 || !i.tags.every((t) => isStr(t) && t.length <= 100)) return false
  if (i.status !== 'inbox' && i.status !== 'organized') return false
  if (!isNum(i.createdAt) || !isNum(i.updatedAt)) return false
  if (i.url !== undefined && (!isStr(i.url) || i.url.length > 4000)) return false
  if (i.blobId !== undefined && !isValidId(i.blobId)) return false
  if (i.mime !== undefined && !isStr(i.mime)) return false
  if (i.fileName !== undefined && !isStr(i.fileName)) return false
  if (i.size !== undefined && !isNum(i.size)) return false
  if (i.deleted !== undefined && typeof i.deleted !== 'boolean') return false
  if (i.pinned !== undefined && typeof i.pinned !== 'boolean') return false
  if (i.suggestion !== undefined) {
    const s = i.suggestion as Record<string, unknown> | null
    if (!s || typeof s !== 'object' || !isStr(s.type) || !isStr(s.folder) || !Array.isArray(s.tags) || !isNum(s.confidence) || !isStr(s.reason)) return false
  }
  return true
}

export interface PairTarget {
  url: string
  token: string
}

/** "http://192.168.1.5:47822/#/pair/<token>" -> { url: "http://192.168.1.5:47822", token } */
export function parsePairLink(text: string): PairTarget | null {
  let u: URL
  try {
    u = new URL(text.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const m = /^#\/pair\/([A-Za-z0-9_-]+)$/.exec(u.hash)
  if (!m || !TOKEN_RE.test(m[1])) return null
  return { url: u.origin, token: m[1] }
}

export function buildPairLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/#/pair/${token}`
}

/**
 * A bookmarklet that sends the current page (or the selected text) to the desktop app.
 * It is written as plain ES5 so it survives being pasted into a bookmark's URL field.
 */
export function buildBookmarklet(clipUrl: string, token: string): string {
  const code = `(function(){
var T=${JSON.stringify(token)},U=${JSON.stringify(clipUrl)};
var sel=String(window.getSelection?window.getSelection():'');
var box=document.createElement('div');
box.style.cssText='position:fixed;z-index:2147483647;top:16px;right:16px;max-width:320px;padding:12px 16px;background:#171a21;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
function say(t,ms){box.textContent=t;if(!box.parentNode)document.body.appendChild(box);if(ms)setTimeout(function(){box.remove()},ms)}
say('Saving to Mindvault…');
fetch(U,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({token:T,url:location.href,title:document.title,selection:sel,html:sel?'':document.documentElement.outerHTML})})
.then(function(r){return r.json()})
.then(function(j){say(j.ok?'Saved to your Mindvault inbox':'Mindvault: '+(j.error||'failed'),2600)})
.catch(function(){say('Could not reach Mindvault. Is the desktop app running? (Some sites block this.)',4000)});
})();`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}

export interface ClipPayload {
  url: string
  title: string
  html: string
  selection: string
}

const MAX_HTML = 10_000_000

/** Validate the body of a clip request. */
export function parseClip(x: unknown): ClipPayload | null {
  if (!x || typeof x !== 'object') return null
  const c = x as Record<string, unknown>
  if (!isStr(c.url) || !/^https?:\/\//i.test(c.url) || c.url.length > 4000) return null
  const title = isStr(c.title) ? c.title.slice(0, 500) : ''
  const html = isStr(c.html) ? c.html : ''
  const selection = isStr(c.selection) ? c.selection : ''
  if (html.length > MAX_HTML || selection.length > MAX_CONTENT) return null
  if (!html && !selection.trim()) return null
  return { url: c.url, title, html, selection }
}
