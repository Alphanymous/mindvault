/**
 * Google sign-in through Google Identity Services. The password is typed on Google's own page,
 * never in this app (Google does not allow apps to take passwords). The user brings their own OAuth client ID.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_KEY = 'mv.google.token'
const EMAIL_KEY = 'mv.google.email'

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

export interface GoogleSession {
  signedIn: boolean
  expiresAt?: number
  email?: string
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
      reject(new Error('Could not reach Google. Check your internet connection.'))
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

const validToken = (): StoredToken | null =>
  memoryToken && memoryToken.expiresAt > Date.now() + 60_000 ? memoryToken : readToken()

export function isSignedIn(): boolean {
  return !!validToken()
}

export function sessionInfo(): GoogleSession {
  const t = validToken()
  let email: string | undefined
  try {
    email = localStorage.getItem(EMAIL_KEY) ?? undefined
  } catch {
    /* ignore */
  }
  return { signedIn: !!t, expiresAt: t?.expiresAt, email: t ? email : undefined }
}

/** Turn Google's error codes into something a person can act on. */
export function friendlyGoogleError(code: string | undefined, fallback = 'Sign-in failed.'): string {
  switch (code) {
    case 'popup_failed_to_open':
      return 'The browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.'
    case 'popup_closed':
      return 'The sign-in window was closed before it finished.'
    case 'access_denied':
      return 'Google denied access. If your app is in Testing mode, add your Google account as a test user (Google Cloud → Google Auth platform → Audience).'
    case 'invalid_client':
      return 'Google does not recognise this client ID. Copy it again from Google Cloud → Credentials.'
    case 'immediate_failed':
    case 'interaction_required':
    case 'login_required':
      return 'Google needs you to sign in again.'
    default:
      return fallback
  }
}

async function fetchAccountEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return undefined
    const json = (await res.json()) as { user?: { emailAddress?: string } }
    return json.user?.emailAddress
  } catch {
    return undefined
  }
}

export interface TokenOptions {
  /** Ask Google to show the account chooser. */
  switchAccount?: boolean
}

/** Returns a valid access token, prompting the user only when `interactive` is true. */
export async function getAccessToken(clientId: string, interactive: boolean, opts: TokenOptions = {}): Promise<string> {
  if (!clientId) throw new Error('Add your Google OAuth client ID in Settings first.')
  const cached = opts.switchAccount ? null : validToken()
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
        if (!r.access_token) return reject(new Error(friendlyGoogleError(r.error, r.error_description || r.error || 'Sign-in was cancelled.')))
        const token = { accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
        memoryToken = token
        writeToken(token)
        void fetchAccountEmail(token.accessToken).then((email) => {
          try {
            if (email) localStorage.setItem(EMAIL_KEY, email)
          } catch {
            /* ignore */
          }
          window.dispatchEvent(new Event('mv:google-session'))
        })
        resolve(token.accessToken)
      },
      error_callback: (e) => reject(new Error(friendlyGoogleError(e.type, e.message || e.type || 'Sign-in failed.'))),
    })
    client.requestAccessToken({ prompt: opts.switchAccount ? 'select_account' : interactive ? '' : 'none' })
  })
}

export async function signOut() {
  const token = validToken()?.accessToken
  memoryToken = null
  writeToken(null)
  try {
    localStorage.removeItem(EMAIL_KEY)
  } catch {
    /* ignore */
  }
  if (token && window.google?.accounts) window.google.accounts.oauth2.revoke(token)
  window.dispatchEvent(new Event('mv:google-session'))
}
