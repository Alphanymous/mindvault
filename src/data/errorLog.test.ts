// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, formatErrors, logError, readErrors } from './errorLog'

describe('errorLog', () => {
  beforeEach(() => {
    localStorage.clear()
    clearErrors()
  })

  it('keeps errors with where they happened, newest first, across reloads', () => {
    logError('capture', new Error('Server answered 403'), 'https://a.test/x')
    logError('screenshot', 'Invalid blob')
    const list = readErrors()
    expect(list.map((e) => e.message)).toEqual(['Invalid blob', 'Server answered 403'])
    expect(list[1]).toMatchObject({ where: 'capture', detail: 'https://a.test/x' })
    expect(JSON.parse(localStorage.getItem('mv.errors') ?? '[]')).toHaveLength(2)
  })

  it('keeps only the most recent 50', () => {
    for (let i = 0; i < 60; i++) logError('x', `e${i}`)
    const list = readErrors()
    expect(list).toHaveLength(50)
    expect(list[0].message).toBe('e59')
  })

  it('formats a copyable report with version and platform', () => {
    logError('capture', new TypeError('Failed to fetch'), 'https://a.test')
    const text = formatErrors('0.3.17', 'Android app')
    expect(text).toContain('Mindvault 0.3.17 (Android app)')
    expect(text).toMatch(/capture: TypeError: Failed to fetch — https:\/\/a\.test/)
  })

  it('survives broken storage', () => {
    localStorage.setItem('mv.errors', '{not json')
    expect(readErrors()).toEqual([])
    logError('x', 'still works')
    expect(readErrors()[0].message).toBe('still works')
  })
})
