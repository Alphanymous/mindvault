import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { bodyHash, PeerNotVerified, sign, signedTransport } from './peerAuth'

const require = createRequire(import.meta.url)
const { createRequestHandler } = require('../../electron/lan-server.cjs') as {
  createRequestHandler(opts: {
    distDir: string
    getToken(): string
    dispatch(msg: Record<string, unknown>): Promise<Record<string, unknown>>
    allowRpc: boolean
    allowedHosts: string[] | null
    allowClip?: boolean
    getPeerUrls?: () => string[]
  }): http.RequestListener
}

const TOKEN = 'tok_ABCDEFGHIJKLMNOP123456'
const servers: http.Server[] = []

async function start(opts: { allowRpc: boolean; allowedHosts?: string[] | null; allowClip?: boolean; getPeerUrls?: () => string[] }) {
  const calls: Record<string, unknown>[] = []
  const handler = createRequestHandler({
    distDir: process.cwd() + '/public',
    getToken: () => TOKEN,
    dispatch: async (msg) => {
      calls.push(msg)
      return { ok: true, echoed: msg.op }
    },
    allowRpc: opts.allowRpc,
    allowedHosts: opts.allowedHosts ?? null,
    allowClip: opts.allowClip,
    getPeerUrls: opts.getPeerUrls,
  })
  const server = http.createServer(handler)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, calls }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('desktop request handler', () => {
  it('answers ping without a token and allows cross-origin callers', async () => {
    const { base } = await start({ allowRpc: true })
    const res = await fetch(`${base}/api/ping`)
    expect(await res.json()).toEqual({ app: 'mindvault', rpc: true })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('answers CORS preflight', async () => {
    const { base } = await start({ allowRpc: true })
    const res = await fetch(`${base}/api/rpc`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('x-mv-sig')
  })

  it('rejects clip and rpc calls without the right token and never dispatches them', async () => {
    const { base, calls } = await start({ allowRpc: true, allowClip: true })
    expect((await post(`${base}/api/clip`, { url: 'https://a.com', html: 'x' })).status).toBe(401)
    expect((await post(`${base}/api/clip`, { token: 'wrong', url: 'https://a.com' })).status).toBe(401)
    expect((await post(`${base}/api/rpc`, { op: 'manifest' }, { authorization: 'Bearer nope' })).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('forwards an authenticated clip (token in body, simple CORS request) and strips the token', async () => {
    const { base, calls } = await start({ allowRpc: false })
    const res = await post(`${base}/api/clip`, { token: TOKEN, url: 'https://a.com', title: 'T', html: '<p>x</p>' })
    expect(await res.json()).toEqual({ ok: true, echoed: 'clip' })
    expect(calls[0]).toEqual({ url: 'https://a.com', title: 'T', html: '<p>x</p>', op: 'clip' })
  })

  it('forwards signed rpc and signs the reply, but only when rpc is enabled', async () => {
    const on = await start({ allowRpc: true })
    expect(await signedTransport(on.base, TOKEN).call({ op: 'manifest' })).toEqual({ ok: true, echoed: 'manifest' })
    const off = await start({ allowRpc: false })
    const res = await post(`${off.base}/api/rpc`, { op: 'manifest' })
    expect(res.status).toBe(404)
    expect(off.calls).toHaveLength(0)
  })

  it('no longer accepts the pairing code itself on the network', async () => {
    const { base, calls } = await start({ allowRpc: true })
    const res = await post(`${base}/api/rpc`, { op: 'manifest' }, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('a phone refuses a device that does not know the pairing code, before sending anything', async () => {
    const { base, calls } = await start({ allowRpc: true })
    await expect(signedTransport(base, 'tok_somebodyElsesCode12345').call({ op: 'manifest' })).rejects.toBeInstanceOf(PeerNotVerified)
    expect(calls).toHaveLength(0)
  })

  it('refuses a copied request and a changed body', async () => {
    const { base, calls } = await start({ allowRpc: true })
    const nonce = 'ab'.repeat(16)
    const hello = (await (await post(`${base}/api/hello`, { nonce })).json()) as { session: string; proof: string }
    expect(hello.proof).toBe(sign(TOKEN, 'host', nonce, hello.session))
    const body = JSON.stringify({ op: 'manifest' })
    const headers = { 'x-mv-session': hello.session, 'x-mv-seq': '1', 'x-mv-sig': sign(TOKEN, 'req', hello.session, '1', bodyHash(body)) }
    expect((await post(`${base}/api/rpc`, body, headers)).status).toBe(200)
    expect((await post(`${base}/api/rpc`, body, headers)).status).toBe(401) // replay
    const changed = JSON.stringify({ op: 'getItem', id: 'abcdef' })
    expect((await post(`${base}/api/rpc`, changed, { ...headers, 'x-mv-seq': '2' })).status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('does not accept web clips on the network server', async () => {
    const { base, calls } = await start({ allowRpc: true, allowClip: false })
    expect((await post(`${base}/api/clip`, { token: TOKEN, url: 'https://a.com', html: 'x' })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('rejects invalid JSON', async () => {
    const { base } = await start({ allowRpc: true, allowClip: true })
    expect((await post(`${base}/api/clip`, '{not json')).status).toBe(400)
  })

  it('refuses foreign Host headers when restricted (DNS rebinding guard)', async () => {
    const { base } = await start({ allowRpc: false, allowedHosts: ['localhost:1'] })
    const res = await fetch(`${base}/api/ping`)
    expect(res.status).toBe(421)
  })

  it('replaces the PWA service worker with a self-removing one so upgrades are never stuck on old files', async () => {
    const { base } = await start({ allowRpc: false })
    const sw = await (await fetch(`${base}/sw.js`)).text()
    expect(sw).toContain('unregister()')
    expect(sw).toContain('caches.delete')
    expect(() => new Function(sw)).not.toThrow()
    expect(await (await fetch(`${base}/registerSW.js`)).text()).toContain('disabled')
  })

  it('does not serve files outside the app folder', async () => {
    const { base } = await start({ allowRpc: false })
    const res = await fetch(`${base}/..%2f..%2fpackage.json`)
    const text = await res.text()
    expect(text).not.toContain('"name": "mindvault"')
  })
})

const { peerBases } = require('../../electron/lan-server.cjs') as {
  peerBases(hostname: string, ips: string[], port: number): string[]
}

describe('pairing addresses', () => {
  it('puts the network name first, so a changed IP address does not break pairing', () => {
    expect(peerBases('DESKTOP-AB12', ['192.168.1.5', '10.0.0.3'], 47822)).toEqual([
      'http://desktop-ab12.local:47822',
      'http://192.168.1.5:47822',
      'http://10.0.0.3:47822',
    ])
  })
  it('skips a name that is not usable on the network', () => {
    expect(peerBases('My PC_é', ['192.168.1.5'], 1)).toEqual(['http://192.168.1.5:1'])
    expect(peerBases('', ['192.168.1.5'], 1)).toEqual(['http://192.168.1.5:1'])
  })
  it('tells a verified phone every address it can use, and nobody else', async () => {
    const urls = ['http://pc.local:1', 'http://192.168.1.5:1']
    const { base, calls } = await start({ allowRpc: true, getPeerUrls: () => urls })
    expect(await signedTransport(base, TOKEN).call({ op: 'peerInfo' })).toEqual({ ok: true, urls })
    expect(calls).toHaveLength(0) // answered by the computer itself
    expect(await (await fetch(`${base}/api/ping`)).json()).toEqual({ app: 'mindvault', rpc: true })
  })
})
