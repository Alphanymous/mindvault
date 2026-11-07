/** Pure last-writer-wins planning, kept separate from I/O so it can be unit tested. */

export interface Stamp {
  updatedAt: number
}

export interface SyncPlan {
  /** Local items that are newer than (or missing from) the remote. */
  push: string[]
  /** Remote items that are newer than (or missing from) local. */
  pull: string[]
}

export function planSync(local: Map<string, Stamp>, remote: Map<string, Stamp>): SyncPlan {
  const push: string[] = []
  const pull: string[] = []
  for (const [id, l] of local) {
    const r = remote.get(id)
    if (!r || l.updatedAt > r.updatedAt) push.push(id)
    else if (r.updatedAt > l.updatedAt) pull.push(id)
  }
  for (const id of remote.keys()) if (!local.has(id)) pull.push(id)
  return { push, pull }
}

/**
 * Keep only incoming copies that are newer than what is stored right now.
 * A sync downloads for a while; an edit made meanwhile must not be overwritten by the older download.
 */
export function onlyNewer<T extends Stamp & { id: string }>(local: Map<string, Stamp>, incoming: T[]): T[] {
  return incoming.filter((i) => {
    const l = local.get(i.id)
    return !l || i.updatedAt > l.updatedAt
  })
}

export interface RemoteEntry<F> {
  updatedAt: number
  file: F
  /** Older copies of the same item, left behind by two syncs that ran at the same time. */
  duplicates: F[]
}

/** Group remote files by item, newest copy first, so stale duplicates never win. */
export function newestRemote<F>(files: { key: string; updatedAt: number; file: F }[]): Map<string, RemoteEntry<F>> {
  const map = new Map<string, RemoteEntry<F>>()
  for (const f of files) {
    const cur = map.get(f.key)
    if (!cur) map.set(f.key, { updatedAt: f.updatedAt, file: f.file, duplicates: [] })
    else if (f.updatedAt > cur.updatedAt) map.set(f.key, { updatedAt: f.updatedAt, file: f.file, duplicates: [...cur.duplicates, cur.file] })
    else map.set(f.key, { ...cur, duplicates: [...cur.duplicates, f.file] })
  }
  return map
}
