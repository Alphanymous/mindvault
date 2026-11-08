import { describe, expect, it } from 'vitest'
import { connectionsOf, neighbourhood, previewText, searchGraph } from './graphQuery'
import type { GraphData, GraphNode } from './types'

const node = (id: string, label: string, degree = 1, kind: GraphNode['kind'] = 'item'): GraphNode => ({ id, label, kind, degree })
const data: GraphData = {
  nodes: [node('a', 'Alpha notes', 3), node('b', 'Beta', 2), node('c', 'Gamma alpha', 1), node('d', 'Delta', 1), node('e', 'Island', 0)],
  edges: [
    { source: 'a', target: 'b', kind: 'link' },
    { source: 'a', target: 'c', kind: 'link' },
    { source: 'b', target: 'd', kind: 'link' },
  ],
}

describe('neighbourhood', () => {
  it('keeps the star and everything within the given number of hops', () => {
    expect(neighbourhood(data, 'a', 1).nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    const two = neighbourhood(data, 'a', 2)
    expect(two.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(two.edges).toHaveLength(3)
  })
  it('returns the whole graph for an unknown star', () => {
    expect(neighbourhood(data, 'zzz', 1)).toBe(data)
  })
})

describe('connectionsOf', () => {
  it('lists connected stars, best connected first', () => {
    expect(connectionsOf(data, 'a').map((n) => n.id)).toEqual(['b', 'c'])
    expect(connectionsOf(data, 'e')).toEqual([])
  })
})

describe('searchGraph', () => {
  it('ranks title starts above matches inside the title, ignores case', () => {
    expect(searchGraph(data.nodes, 'alpha').map((n) => n.id)).toEqual(['a', 'c'])
  })
  it('matches extra text such as tags and folders', () => {
    const extra = new Map([['d', 'travel #trips']])
    expect(searchGraph(data.nodes, 'trips', extra).map((n) => n.id)).toEqual(['d'])
  })
  it('returns nothing for an empty query', () => {
    expect(searchGraph(data.nodes, '  ')).toEqual([])
  })
})

describe('previewText', () => {
  it('turns markdown into a short plain sentence', () => {
    expect(previewText('# Title\n\nSome **bold** text with a [[Link]] and [site](https://x.com).\n- item', 60)).toBe('Some bold text with a Link and site. item')
  })
  it('cuts long text on a word', () => {
    expect(previewText('one two three four five six', 14)).toBe('one two three…')
  })
})
