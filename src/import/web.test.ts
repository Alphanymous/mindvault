// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHtmlWithRoute } from './web'

vi.mock('../data/store', () => ({ getState: () => ({ settings: { clipProxy: '' } }) }))

const fail = (error: Error) => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
const asAndroid = () => ((window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true })

describe('fetchHtmlWithRoute failure messages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
  })

  it('reports a timeout as a timeout, not a CORS block', async () => {
    fail(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))
    await expect(fetchHtmlWithRoute('https://a.test')).rejects.toThrow('did not answer within 20 seconds')
  })

  it('in the Android app, names the failure instead of suggesting the Android app', async () => {
    asAndroid()
    fail(new TypeError('Failed to fetch'))
    await expect(fetchHtmlWithRoute('https://a.test')).rejects.toThrow(/^The download failed \(Failed to fetch\)\.$/)
  })

  it('in a browser, still explains the CORS block', async () => {
    fail(new TypeError('Failed to fetch'))
    await expect(fetchHtmlWithRoute('https://a.test')).rejects.toThrow(/CORS/)
  })
})
