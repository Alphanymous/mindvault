import { describe, expect, it } from 'vitest'
import { newestRemote, onlyNewer, planSync } from './plan'

const m = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, v]) => [k, { updatedAt: v }]))

describe('planSync', () => {
  it('pushes newer/missing local and pulls newer/missing remote', () => {
    const plan = planSync(m({ a: 5, b: 1, c: 3, d: 9 }), m({ a: 5, b: 4, c: 3, e: 2 }))
    expect(plan.push.sort()).toEqual(['d'])
    expect(plan.pull.sort()).toEqual(['b', 'e'])
  })
  it('does nothing when in sync', () => {
    expect(planSync(m({ a: 1 }), m({ a: 1 }))).toEqual({ push: [], pull: [] })
  })
  it('treats a newer local tombstone as a push', () => {
    expect(planSync(m({ a: 10 }), m({ a: 2 })).push).toEqual(['a'])
  })
})

describe('onlyNewer', () => {
  const it3 = (id: string, updatedAt: number) => ({ id, updatedAt })
  it('drops incoming copies that are not newer than what is stored now', () => {
    // a local edit made while the sync was downloading must survive
    const local = new Map([['a', it3('a', 50)], ['b', it3('b', 10)]])
    const incoming = [it3('a', 40), it3('b', 20), it3('c', 1)]
    expect(onlyNewer(local, incoming).map((i) => i.id)).toEqual(['b', 'c'])
  })
  it('drops an equal copy (nothing to apply)', () => {
    expect(onlyNewer(new Map([['a', it3('a', 5)]]), [it3('a', 5)])).toEqual([])
  })
})

describe('newestRemote', () => {
  it('keeps the newest of duplicate remote files for one item', () => {
    const files = [
      { key: 'a', updatedAt: 5, file: 'old' },
      { key: 'a', updatedAt: 9, file: 'new' },
      { key: 'a', updatedAt: 7, file: 'mid' },
      { key: 'b', updatedAt: 1, file: 'only' },
    ]
    const map = newestRemote(files)
    expect(map.get('a')).toEqual({ updatedAt: 9, file: 'new', duplicates: ['old', 'mid'] })
    expect(map.get('b')).toEqual({ updatedAt: 1, file: 'only', duplicates: [] })
  })
})
