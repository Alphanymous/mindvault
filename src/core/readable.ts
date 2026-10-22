/** Extract a readable article from raw HTML as Markdown. Pure DOM code, no network. */

export interface ReadableResult {
  title: string
  markdown: string
  siteName?: string
  description?: string
}

const DROP_SELECTOR =
  'script,style,noscript,template,svg,canvas,iframe,form,button,input,select,textarea,nav,aside,footer,header,' +
  '[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"],.advert,.ads,.cookie,.share,.sidebar,.comments,.related'

export function extractReadable(html: string, baseUrl?: string): ReadableResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = (name: string) =>
    doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content')?.trim() || undefined

  const title =
    meta('og:title') || doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || 'Untitled page'
  const siteName = meta('og:site_name')
  const description = meta('og:description') || meta('description')

  const root = pickContentRoot(doc)
  root.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove())

  const md = nodeToMarkdown(root, baseUrl).replace(/\n{3,}/g, '\n\n').trim()
  return { title: cleanTitle(title, siteName), markdown: md, siteName, description }
}

function cleanTitle(title: string, site?: string): string {
  let t = title.replace(/\s+/g, ' ').trim()
  if (site) t = t.replace(new RegExp(`\\s*[|\\-–—·]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
  return t
}

function pickContentRoot(doc: Document): Element {
  const body = doc.body ?? doc.documentElement
  const direct = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.querySelector('[role="main"]')
  if (direct && textLength(direct) > 200) return direct

  // Fallback: block with the best text-density score.
  let best: Element = body
  let bestScore = 0
  body.querySelectorAll('div,section').forEach((el) => {
    const paras = el.querySelectorAll(':scope > p, :scope > div > p').length
    const len = textLength(el)
    const linkLen = [...el.querySelectorAll('a')].reduce((n, a) => n + (a.textContent?.length ?? 0), 0)
    const score = paras * 40 + len - linkLen * 2
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  })
  return bestScore > 150 ? best : body
}

function textLength(el: Element): number {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
}

function absolutize(href: string, base?: string): string {
  if (!base) return href
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

function inline(node: Node, base?: string): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const inner = () => [...el.childNodes].map((c) => inline(c, base)).join('')
  switch (tag) {
    case 'strong':
    case 'b':
      return inner().trim() ? `**${inner().trim()}**` : ''
    case 'em':
    case 'i':
      return inner().trim() ? `*${inner().trim()}*` : ''
    case 'code':
      return `\`${el.textContent ?? ''}\``
    case 'br':
      return '\n'
    case 'a': {
      const href = el.getAttribute('href')
      const text = inner().trim()
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || !text) return text
      return `[${text}](${absolutize(href, base)})`
    }
    case 'img': {
      const alt = el.getAttribute('alt')?.trim()
      return alt ? `*[image: ${alt}]*` : ''
    }
    default:
      return inner()
  }
}

function nodeToMarkdown(node: Node, base?: string, depth = 0): string {
  if (node.nodeType === 3) return ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const children = () =>
    [...el.childNodes]
      .map((c) => (c.nodeType === 3 ? inline(c, base) : isBlock(c) ? nodeToMarkdown(c, base, depth) : inline(c, base)))
      .join('')

  if (/^h[1-6]$/.test(tag)) {
    const text = inline(el, base).replace(/\s+/g, ' ').trim()
    return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : ''
  }
  switch (tag) {
    case 'p': {
      const text = inline(el, base).trim()
      return text ? `\n\n${text}\n\n` : ''
    }
    case 'pre':
      return `\n\n\`\`\`\n${(el.textContent ?? '').replace(/\n+$/, '')}\n\`\`\`\n\n`
    case 'blockquote': {
      const inner = children().trim()
      return inner ? `\n\n${inner.split('\n').map((l) => `> ${l}`).join('\n')}\n\n` : ''
    }
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol'
      const items = [...el.children].filter((c) => c.tagName.toLowerCase() === 'li')
      const lines = items.map((li, i) => {
        const bullet = ordered ? `${i + 1}.` : '-'
        const nested = [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName))
        const clone = li.cloneNode(true) as Element
        clone.querySelectorAll('ul,ol').forEach((n) => n.remove())
        const text = inline(clone, base).replace(/\s+/g, ' ').trim()
        const sub = nested.map((n) => nodeToMarkdown(n, base, depth + 1)).join('')
        return `${'  '.repeat(depth)}${bullet} ${text}${sub ? '\n' + sub.replace(/^\n+|\n+$/g, '') : ''}`
      })
      return `\n\n${lines.join('\n')}\n\n`
    }
    case 'hr':
      return '\n\n---\n\n'
    case 'table': {
      const rows = [...el.querySelectorAll('tr')].map((tr) =>
        [...tr.children].map((c) => inline(c, base).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()),
      )
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
      const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`]
      for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(' | ')} |`)
      return `\n\n${lines.join('\n')}\n\n`
    }
    default:
      return children()
  }
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'details', 'summary', 'dl', 'dd', 'dt',
])

function isBlock(node: Node): boolean {
  return node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName.toLowerCase())
}
