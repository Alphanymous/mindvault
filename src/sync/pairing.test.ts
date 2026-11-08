import { describe, expect, it } from 'vitest'
import { buildBookmarklet, buildPairLink, isLocalNetworkHost, isValidItem, parseClip, parsePairLink, peerCandidates } from './pairing'

const TOKEN = 'AbCdEfGh1234567_-xyzAB'

describe('pairing links', () => {
  it('round-trips a link', () => {
    const link = buildPairLink('http://192.168.1.5:47822/', TOKEN)
    expect(link).toBe(`http://192.168.1.5:47822/#/pair/${TOKEN}`)
    expect(parsePairLink(`  ${link}\n`)).toEqual({ url: 'http://192.168.1.5:47822', token: TOKEN })
  })
  it('rejects anything else', () => {
    expect(parsePairLink('hello')).toBeNull()
    expect(parsePairLink('javascript:alert(1)')).toBeNull()
    expect(parsePairLink('http://10.0.0.2:1/#/pair/short')).toBeNull()
    expect(parsePairLink('http://10.0.0.2:1/#/other/' + TOKEN)).toBeNull()
    expect(parsePairLink('ftp://10.0.0.2/#/pair/' + TOKEN)).toBeNull()
  })
})

describe('isValidItem', () => {
  const ok = { id: 'abc12345', type: 'note', title: 't', content: 'c', folder: '', tags: ['a'], status: 'inbox', createdAt: 1, updatedAt: 2 }
  it('accepts a normal item', () => expect(isValidItem(ok)).toBe(true))
  it.each([
    ['bad id', { ...ok, id: 'a/b' }],
    ['bad type', { ...ok, type: 'exe' }],
    ['non-string tag', { ...ok, tags: [1] }],
    ['bad status', { ...ok, status: 'x' }],
    ['NaN date', { ...ok, updatedAt: NaN }],
    ['bad blob id', { ...ok, blobId: '../x' }],
    ['huge content', { ...ok, content: 'x'.repeat(6_000_001) }],
    ['array', []],
    ['null', null],
  ])('rejects %s', (_n, v) => expect(isValidItem(v)).toBe(false))
})

describe('web clipper', () => {
  it('validates clip payloads', () => {
    expect(parseClip({ url: 'https://a.com/x', title: 'T', html: '<p>hi</p>', selection: '' })).toMatchObject({ url: 'https://a.com/x' })
    expect(parseClip({ url: 'file:///etc/passwd', html: 'x' })).toBeNull()
    expect(parseClip({ url: 'https://a.com', html: '', selection: '  ' })).toBeNull()
    expect(parseClip({ url: 'https://a.com', html: 'x'.repeat(10_000_001) })).toBeNull()
    expect(parseClip('nope')).toBeNull()
  })
  it('builds a single-line javascript: bookmarklet that embeds the endpoint and token', () => {
    const b = buildBookmarklet('http://localhost:47821/api/clip', TOKEN)
    expect(b.startsWith('javascript:')).toBe(true)
    expect(b).not.toMatch(/\s/)
    const code = decodeURIComponent(b.slice('javascript:'.length))
    expect(code).toContain(JSON.stringify(TOKEN))
    expect(code).toContain('localhost:47821/api/clip')
    expect(() => new Function(code)).not.toThrow()
  })
})

describe('peer address list', () => {
  it('keeps only plain http(s) origins, without duplicates, primary first', () => {
    expect(
      peerCandidates('http://pc.local:47822', ['http://192.168.1.5:47822/', 'javascript:alert(1)', 'http://pc.local:47822', 'ftp://x', 42, 'http://10.0.0.3:47822/#/pair/x']),
    ).toEqual(['http://pc.local:47822', 'http://192.168.1.5:47822', 'http://10.0.0.3:47822'])
  })
  it('caps the list so a peer cannot flood it', () => {
    const many = Array.from({ length: 50 }, (_, i) => `http://10.0.0.${i}:1`)
    expect(peerCandidates('', many)).toHaveLength(8)
  })
})

describe('local network only', () => {
  it('drops internet addresses a peer reports, but keeps the address you paired with', () => {
    expect(peerCandidates('http://pc.local:1', ['http://evil.example:1', 'http://8.8.8.8:1', 'http://192.168.1.5:1', 'http://172.20.0.2:1', 'http://172.32.0.2:1'])).toEqual([
      'http://pc.local:1',
      'http://192.168.1.5:1',
      'http://172.20.0.2:1',
    ])
    expect(peerCandidates('https://my-vps.example', [])).toEqual(['https://my-vps.example'])
  })
  it('recognises home network names and private ranges', () => {
    for (const h of ['desktop-ab12.local', '10.1.2.3', '192.168.0.10', '169.254.3.4', '100.100.1.1', '[fd12:3456::1]', 'fe80::1']) expect(isLocalNetworkHost(h)).toBe(true)
    for (const h of ['example.com', '8.8.8.8', '172.15.0.1', '192.169.0.1', 'local', '999.1.1.1', '2001:db8::1']) expect(isLocalNetworkHost(h)).toBe(false)
  })
})

describe('item links from other devices', () => {
  const base = { id: 'abcdef12', type: 'web', title: 't', content: '', folder: '', tags: [], status: 'organized', createdAt: 1, updatedAt: 1 }
  it('accepts web addresses only', () => {
    expect(isValidItem({ ...base, url: 'https://a.com/x' })).toBe(true)
    expect(isValidItem({ ...base, url: 'javascript:alert(1)' })).toBe(false)
    expect(isValidItem({ ...base, url: 'data:text/html,<script>1</script>' })).toBe(false)
  })
})
