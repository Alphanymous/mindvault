// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { extractReadable } from './readable'

const PAGE = `<!doctype html><html><head><title>Great Post | Acme Blog</title>
<meta property="og:site_name" content="Acme Blog"><meta property="og:description" content="A summary.">
<style>.x{}</style></head><body>
<header><nav><a href="/">Home</a></nav></header>
<article>
  <h1>Great Post</h1>
  <p>First paragraph with <strong>bold</strong> and a <a href="/docs">relative link</a>. ${'Filler text. '.repeat(20)}</p>
  <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
  <pre>const a = 1</pre>
  <table><tr><th>K</th><th>V</th></tr><tr><td>a</td><td>1</td></tr></table>
  <script>alert(1)</script>
</article>
<footer>copyright</footer></body></html>`

describe('extractReadable', () => {
  const r = extractReadable(PAGE, 'https://acme.test/posts/1')
  it('cleans the title using the site name', () => {
    expect(r.title).toBe('Great Post')
    expect(r.siteName).toBe('Acme Blog')
    expect(r.description).toBe('A summary.')
  })
  it('converts structure to markdown and absolutizes links', () => {
    expect(r.markdown).toContain('# Great Post')
    expect(r.markdown).toContain('**bold**')
    expect(r.markdown).toContain('[relative link](https://acme.test/docs)')
    expect(r.markdown).toContain('- One')
    expect(r.markdown).toContain('  - Nested')
    expect(r.markdown).toContain('```\nconst a = 1\n```')
    expect(r.markdown).toContain('| K | V |')
  })
  it('drops scripts, nav and footer', () => {
    expect(r.markdown).not.toContain('alert')
    expect(r.markdown).not.toContain('copyright')
    expect(r.markdown).not.toContain('Home')
  })
  it('falls back to a text-dense block without <article>', () => {
    const body = '<div><div class="menu"><a href="/a">a</a><a href="/b">b</a></div><div class="post"><p>' + 'Real content here. '.repeat(30) + '</p><p>' + 'More. '.repeat(30) + '</p></div></div>'
    const out = extractReadable(`<html><head><title>T</title></head><body>${body}</body></html>`)
    expect(out.markdown).toContain('Real content here.')
  })
})
