import { describe, expect, it, vi } from 'vitest'

vi.mock('./store', () => ({
  getState: () => ({ settings: { llmEndpoint: 'http://llm.test/v1/chat/completions', llmModel: 'm', llmApiKey: 'k', embeddingsEndpoint: 'http://llm.test/v1/embeddings', embeddingsModel: 'e', googleClientId: '' } }),
}))
vi.mock('../import/web', () => ({ fetchHtmlWithRoute: vi.fn() }))
vi.mock('../sync/google', () => ({ getAccessToken: vi.fn() }))

import { fetchHtmlWithRoute } from '../import/web'
import { getAccessToken } from '../sync/google'
import { testChat, testClipDownload, testDrive, testEmbeddings } from './connections'

const fetchMock = (impl: (url: string) => Response | Promise<Response>) => vi.stubGlobal('fetch', vi.fn(async (u: string) => impl(u)))

describe('connection tests', () => {
  it('chat: reports the model answer, or the failure with a CORS hint for network errors', async () => {
    fetchMock(() => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })))
    expect(await testChat()).toMatchObject({ ok: true, message: expect.stringContaining('“OK”') })
    fetchMock(() => new Response('no', { status: 401 }))
    expect(await testChat()).toMatchObject({ ok: false, message: expect.stringContaining('401') })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await testChat()).toMatchObject({ ok: false, message: expect.stringContaining('CORS') })
  })

  it('embeddings: reports vector size', async () => {
    fetchMock(() => new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })))
    expect(await testEmbeddings()).toMatchObject({ ok: true, message: expect.stringContaining('3-number') })
  })

  it('clip download: names the route used and rejects wrong pages', async () => {
    vi.mocked(fetchHtmlWithRoute).mockResolvedValueOnce({ html: '<h1>Example Domain</h1>', route: 'desktop' })
    expect(await testClipDownload()).toMatchObject({ ok: true, message: expect.stringContaining('desktop app') })
    vi.mocked(fetchHtmlWithRoute).mockResolvedValueOnce({ html: '<html>login required</html>', route: 'proxy' })
    expect(await testClipDownload()).toMatchObject({ ok: false })
    vi.mocked(fetchHtmlWithRoute).mockRejectedValueOnce(new Error('blocked'))
    expect(await testClipDownload()).toEqual({ ok: false, message: 'blocked' })
  })

  it('drive: explains a disabled API and success', async () => {
    vi.mocked(getAccessToken).mockResolvedValue('tok')
    fetchMock(() => new Response('{"error":{"errors":[{"reason":"accessNotConfigured"}]}}', { status: 403 }))
    expect(await testDrive()).toMatchObject({ ok: false, message: expect.stringContaining('switched off') })
    fetchMock(() => new Response('{"files":[]}'))
    expect(await testDrive()).toMatchObject({ ok: true })
    vi.mocked(getAccessToken).mockRejectedValueOnce(new Error('The sign-in window was closed before it finished.'))
    expect(await testDrive()).toMatchObject({ ok: false, message: expect.stringContaining('closed') })
  })
})
