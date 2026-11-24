/**
 * A small on-device log of recent failures, so a problem on a phone can be reported with the exact error.
 * Kept in localStorage (per device, never synced) and shown in Settings → About with a Copy button.
 */
export interface LoggedError {
  at: number
  where: string
  message: string
  detail?: string
}

const KEY = 'mv.errors'
const MAX = 50
let cache: LoggedError[] | null = null

export function readErrors(): LoggedError[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(parsed) ? (parsed as LoggedError[]) : []
  } catch {
    cache = []
  }
  return cache
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message
  return typeof error === 'string' ? error : JSON.stringify(error) ?? String(error)
}

export function logError(where: string, error: unknown, detail?: string): void {
  const entry: LoggedError = { at: Date.now(), where, message: describe(error), ...(detail ? { detail } : {}) }
  cache = [entry, ...readErrors()].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Storage full or blocked: the in-memory copy still shows in Settings until the app closes.
  }
}

export function clearErrors(): void {
  cache = []
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** Plain-text report for pasting into a message. */
export function formatErrors(version: string, platform: string): string {
  const lines = readErrors().map((e) => `${new Date(e.at).toISOString()} ${e.where}: ${e.message}${e.detail ? ` — ${e.detail}` : ''}`)
  return [`Mindvault ${version} (${platform})`, ...(lines.length ? lines : ['No errors recorded.'])].join('\n')
}

/** Record errors nothing else caught (a failed promise in a click handler, a crash in a callback). */
export function watchUncaughtErrors(): void {
  window.addEventListener('error', (e) => logError('uncaught', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => logError('uncaught', e.reason))
}
