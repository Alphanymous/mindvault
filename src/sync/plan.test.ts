import { describe, expect, it } from 'vitest'
import { planSync } from './plan'

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
