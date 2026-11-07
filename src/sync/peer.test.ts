import { describe, expect, it } from 'vitest'
import { firstReachable, mixedContentProblem } from './peer'

const PEER = 'http://192.168.1.5:47822'

describe('mixedContentProblem', () => {
  it('blocks an http peer from an https web page', () => {
    expect(mixedContentProblem(PEER, 'https://mindvault.example', false)).toMatch(/https/)
  })

  it('allows an http peer inside the Android app, which uses native HTTP', () => {
    expect(mixedContentProblem(PEER, 'https://localhost', true)).toBeNull()
  })

  it('allows an http peer from an http page', () => {
    expect(mixedContentProblem(PEER, 'http://192.168.1.5:47822', false)).toBeNull()
  })

  it('allows an https peer from an https page', () => {
    expect(mixedContentProblem('https://peer.example', 'https://mindvault.example', false)).toBeNull()
  })
})

describe('firstReachable', () => {
  it('tries addresses in order and returns the first that answers', async () => {
    const tried: string[] = []
    const ping = async (u: string) => { tried.push(u); return u.includes('10.0.0.3') }
    expect(await firstReachable(['http://pc.local:1', 'http://10.0.0.3:1', 'http://x:1'], ping)).toBe('http://10.0.0.3:1')
    expect(tried).toEqual(['http://pc.local:1', 'http://10.0.0.3:1'])
  })
  it('returns null when nothing answers', async () => {
    expect(await firstReachable(['http://a:1'], async () => false)).toBeNull()
  })
})
