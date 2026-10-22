import { describe, expect, it } from 'vitest'
import { excerpt, firstHeading, frontmatterTags, parseFrontmatter, parseInlineTags, parseWikiLinks, titleFromFileName } from './markdown'

describe('parseWikiLinks', () => {
  it('parses plain, aliased and heading links', () => {
    const links = parseWikiLinks('See [[Alpha]], [[Beta|the beta]] and [[Gamma#Setup]] and [[Delta#H|d]].')
    expect(links).toEqual([
      { target: 'Alpha', heading: undefined, alias: undefined },
      { target: 'Beta', heading: undefined, alias: 'the beta' },
      { target: 'Gamma', heading: 'Setup', alias: undefined },
      { target: 'Delta', heading: 'H', alias: 'd' },
    ])
  })

  it('ignores links inside code', () => {
    expect(parseWikiLinks('`[[no]]` and\n```\n[[nope]]\n```\n[[yes]]').map((l) => l.target)).toEqual(['yes'])
  })

  it('ignores empty links', () => {
    expect(parseWikiLinks('[[ ]] [[|x]]')).toEqual([])
  })
})

describe('parseInlineTags', () => {
  it('finds tags but not headings, urls, anchors or wikilinks', () => {
    const tags = parseInlineTags('# Heading\nHello #Idea and #dev/web, see https://x.com/#frag and [[Note#sec]] and C#')
    expect(tags.sort()).toEqual(['dev/web', 'idea'])
  })
  it('skips numeric-only hashes', () => {
    expect(parseInlineTags('issue #123 fixed')).toEqual([])
  })
})

describe('frontmatter', () => {
  it('parses scalar, inline list and block list', () => {
    const fm = parseFrontmatter('---\ntitle: "Hi"\ntags: [a, "b c"]\nfolder: Dev\naliases:\n  - x\n  - y\n---\nBody')
    expect(fm.body).toBe('Body')
    expect(fm.data.title).toBe('Hi')
    expect(fm.data.tags).toEqual(['a', 'b c'])
    expect(fm.data.aliases).toEqual(['x', 'y'])
    expect(frontmatterTags(fm)).toEqual(['a', 'b-c'])
  })
  it('returns body untouched without frontmatter', () => {
    expect(parseFrontmatter('just text').body).toBe('just text')
  })
})

describe('titles and excerpts', () => {
  it('finds first heading', () => {
    expect(firstHeading('---\ntags: x\n---\n\n## My Title ##\ntext')).toBe('My Title')
  })
  it('derives title from filename', () => {
    expect(titleFromFileName('my_great-note.md')).toBe('my great note')
  })
  it('builds a plain excerpt', () => {
    expect(excerpt('# Hi\n\nSome **bold** [link](http://x) and [[Wiki|alias]]', 100)).toBe('Hi Some bold link and Wiki')
  })
})
