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
