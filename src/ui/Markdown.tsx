import { useMemo, type MouseEvent } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { parseFrontmatter } from '../core/markdown'
import { useAppState } from '../data/store'
import { createItem } from '../data/store'
import { go } from './router'

const marked = new Marked({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  }
})

/** Turn [[Target|alias]] into links with a private scheme, outside of code. */
function wikilinksToLinks(src: string, resolve: (t: string) => string | null): string {
  const codeSpans: string[] = []
  const hidden = src.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    codeSpans.push(m)
    return `\u0000${codeSpans.length - 1}\u0000`
  })
  const linked = hidden.replace(/\[\[([^\]\n]+?)\]\]/g, (_, inner: string) => {
    const [targetPart, ...aliasParts] = inner.split('|')
    const target = targetPart.split('#')[0].trim()
    if (!target) return inner
    const label = (aliasParts.join('|').trim() || targetPart.trim()).replace(/[[\]]/g, '')
    const found = resolve(target)
    return `[${label}](wikilink:${encodeURIComponent(found ?? target)}${found ? '' : '?missing'})`
  })
  return linked.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codeSpans[Number(i)])
}

export function renderMarkdown(src: string, resolve: (t: string) => string | null): string {
  const body = parseFrontmatter(src).body
  const html = marked.parse(wikilinksToLinks(body, resolve), { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|wikilink|tel):|#)/i })
}

export function Markdown({ source }: { source: string }) {
  const { links } = useAppState()
  const html = useMemo(() => renderMarkdown(source, links.resolve), [source, links])

  const onClick = async (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href?.startsWith('wikilink:')) return
    e.preventDefault()
    const [raw, flag] = href.slice('wikilink:'.length).split('?')
    const value = decodeURIComponent(raw)
    if (flag === 'missing') {
      const item = await createItem({ title: value, content: `# ${value}\n\n`, organized: true, type: 'note' })
      go({ name: 'item', id: item.id })
    } else {
      go({ name: 'item', id: value })
    }
  }

  return (
    <div
      className="prose"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
      // wikilinks to missing notes get a dashed style
      ref={(el) => {
        el?.querySelectorAll('a[href^="wikilink:"]').forEach((a) => {
          a.classList.add('wikilink')
          if ((a.getAttribute('href') ?? '').includes('?missing')) a.classList.add('missing')
        })
      }}
    />
  )
}

