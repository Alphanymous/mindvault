/** Google Identity Services (token model) wrapper. The user brings their own OAuth client ID. */

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_KEY = 'mv.google.token'

interface StoredToken {
  accessToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string
        scope: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type?: string; message?: string }) => void
      }): TokenClient
      revoke(token: string, done?: () => void): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleGlobal
  }
}

let gisPromise: Promise<GoogleGlobal> | null = null

function loadGis(): Promise<GoogleGlobal> {
  if (window.google?.accounts) return Promise.resolve(window.google)
  gisPromise ??= new Promise<GoogleGlobal>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => (window.google?.accounts ? resolve(window.google) : reject(new Error('Google sign-in did not load.')))
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Could not reach Google (offline?).'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as StoredToken
    return t.expiresAt > Date.now() + 60_000 ? t : null
  } catch {
    return null
  }
}

function writeToken(t: StoredToken | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage may be unavailable; token stays in memory for the session */
  }
}

let memoryToken: StoredToken | null = null

export function isSignedIn(): boolean {
  return !!(memoryToken && memoryToken.expiresAt > Date.now() + 60_000) || !!readToken()
}

/** Returns a valid access token, prompting the user only when `interactive` is true. */
export async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  if (!clientId) throw new Error('Add your Google OAuth client ID in Settings first.')
  const cached = memoryToken && memoryToken.expiresAt > Date.now() + 60_000 ? memoryToken : readToken()
  if (cached) {
    memoryToken = cached
    return cached.accessToken
  }
  const google = await loadGis()
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new Error(r.error_description || r.error || 'Sign-in was cancelled.'))
        const token = { accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
        memoryToken = token
        writeToken(token)
        resolve(token.accessToken)
      },
      error_callback: (e) => reject(new Error(e.message || e.type || 'Sign-in failed.')),
    })
    client.requestAccessToken({ prompt: interactive ? '' : 'none' })
  })
}

export async function signOut() {
  const token = memoryToken?.accessToken ?? readToken()?.accessToken
  memoryToken = null
  writeToken(null)
  if (token && window.google?.accounts) window.google.accounts.oauth2.revoke(token)
}
