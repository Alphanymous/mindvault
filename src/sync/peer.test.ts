import { describe, expect, it } from 'vitest'
import { mixedContentProblem } from './peer'

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
