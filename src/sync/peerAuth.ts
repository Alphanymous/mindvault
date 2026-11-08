/**
 * Signed requests between a phone and the paired computer, so the pairing code never crosses the network.
 *
 *   1. hello: the phone sends a random value; the computer answers with its own random value (the session)
 *      and a proof that it knows the code. The phone checks the proof before it sends or accepts any data,
 *      so a device that only pretends to be the computer gets nothing.
 *   2. each request carries a sequence number and a signature over the session, the number and the body;
 *      each reply is signed the same way. Copied requests are refused, changed bodies fail the check.
 *
 * Pure JavaScript hashing is used on purpose: an iPhone that opened Mindvault from the computer over plain
 * http has no built-in browser crypto. The computer's side lives in electron/lan-server.cjs.
 */
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import type { RpcMessage, Transport } from './peerEngine'

const PROTOCOL = 'mv1'
const REQUEST_TIMEOUT_MS = 120_000

export const UNREACHABLE_MESSAGE =
  'Can’t reach your computer. Make sure it is on, Mindvault is open there with phone pairing switched on, and both are on the same Wi-Fi. Syncing resumes by itself when it is back.'

/** Nothing answered at the address. */
export class PeerUnreachable extends Error {
  constructor() {
    super(UNREACHABLE_MESSAGE)
  }
}

/** Something answered, but it could not prove it knows the pairing code. */
export class PeerNotVerified extends Error {
  constructor() {
    super('The device at that address could not prove it is your paired computer, so nothing was sent. Pair again from your computer’s current code.')
  }
}

export const sign = (token: string, ...parts: string[]) =>
  bytesToHex(hmac(sha256, utf8ToBytes(token), utf8ToBytes([PROTOCOL, ...parts].join('|'))))
export const bodyHash = (body: string) => bytesToHex(sha256(utf8ToBytes(body)))
export const newNonce = () => bytesToHex(randomBytes(16))

/** Compare without stopping at the first difference. */
export function sameText(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Transport that signs every request to the paired computer and checks every reply. */
export function signedTransport(baseUrl: string, token: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Transport {
  const base = baseUrl.replace(/\/+$/, '')
  let session: { id: string; seq: number } | null = null

  const post = async (path: string, body: string, headers: Record<string, string> = {}) => {
    try {
      return await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new PeerUnreachable()
    }
  }

  async function hello() {
    const mine = newNonce()
    const res = await post('/api/hello', JSON.stringify({ nonce: mine }))
    if (res.status === 404) throw new Error('Update Mindvault on your computer to the same version as this device, then sync again.')
    if (!res.ok) throw new PeerNotVerified()
    const json = (await res.json().catch(() => null)) as { session?: unknown; proof?: unknown } | null
    const id = typeof json?.session === 'string' && /^[0-9a-f]{32}$/.test(json.session) ? json.session : null
    if (!id || !sameText(json?.proof, sign(token, 'host', mine, id))) throw new PeerNotVerified()
    session = { id, seq: 0 }
    return session
  }

  async function signedCall(msg: RpcMessage, retry: boolean): Promise<Record<string, unknown>> {
    const s = session ?? (await hello())
    const seq = String(++s.seq)
    const body = JSON.stringify(msg)
    const res = await post('/api/rpc', body, {
      'x-mv-session': s.id,
      'x-mv-seq': seq,
      'x-mv-sig': sign(token, 'req', s.id, seq, bodyHash(body)),
    })
    if (res.status === 401) {
      session = null
      // The computer restarted or the session expired: start a fresh one once.
      if (retry) return signedCall(msg, false)
      throw new Error('Your computer rejected this device. Reset pairing there and pair again.')
    }
    if (!res.ok) throw new Error(`Your computer answered with error ${res.status}`)
    const text = await res.text()
    if (!sameText(res.headers.get('x-mv-sig'), sign(token, 'res', s.id, seq, bodyHash(text)))) throw new PeerNotVerified()
    return JSON.parse(text) as Record<string, unknown>
  }

  return { call: (msg) => signedCall(msg, true) }
}
