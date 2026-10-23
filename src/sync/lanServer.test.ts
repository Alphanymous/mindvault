import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createRequestHandler } = require('../../electron/lan-server.cjs') as {
  createRequestHandler(opts: {
    distDir: string
    getToken(): string
    dispatch(msg: Record<string, unknown>): Promise<Record<string, unknown>>
    allowRpc: boolean
    allowedHosts: string[] | null
  }): http.RequestListener
}

const TOKEN = 'tok_ABCDEFGHIJKLMNOP123456'
const servers: http.Server[] = []

async function start(opts: { allowRpc: boolean; allowedHosts?: string[] | null }) {
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
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('rejects clip and rpc calls without the right token and never dispatches them', async () => {
    const { base, calls } = await start({ allowRpc: true })
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

  it('forwards rpc with a bearer token, but only when rpc is enabled', async () => {
    const on = await start({ allowRpc: true })
    const ok = await post(`${on.base}/api/rpc`, { op: 'manifest' }, { authorization: `Bearer ${TOKEN}` })
    expect(await ok.json()).toEqual({ ok: true, echoed: 'manifest' })
    const off = await start({ allowRpc: false })
    const res = await post(`${off.base}/api/rpc`, { op: 'manifest' }, { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(404)
    expect(off.calls).toHaveLength(0)
  })

  it('rejects invalid JSON', async () => {
    const { base } = await start({ allowRpc: true })
    expect((await post(`${base}/api/clip`, '{not json')).status).toBe(400)
  })

  it('refuses foreign Host headers when restricted (DNS rebinding guard)', async () => {
    const { base } = await start({ allowRpc: false, allowedHosts: ['localhost:1'] })
    const res = await fetch(`${base}/api/ping`)
    expect(res.status).toBe(421)
  })

  it('does not serve files outside the app folder', async () => {
    const { base } = await start({ allowRpc: false })
    const res = await fetch(`${base}/..%2f..%2fpackage.json`)
    const text = await res.text()
    expect(text).not.toContain('"name": "mindvault"')
  })
})
