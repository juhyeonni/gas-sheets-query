/**
 * naming tests - single source of truth for namespaced storage names
 */
import { describe, it, expect } from 'vitest'
import { composeName } from '../../../src/local/naming.js'

describe('composeName', () => {
  it('returns the base name unchanged when namespace is omitted', () => {
    expect(composeName('gsquery')).toBe('gsquery')
    expect(composeName('gsquery', undefined)).toBe('gsquery')
  })

  it('returns the base name unchanged when namespace is empty string', () => {
    expect(composeName('gsquery', '')).toBe('gsquery')
  })

  it('appends the namespace with a colon separator', () => {
    expect(composeName('gsquery', 'team:t1')).toBe('gsquery:team:t1')
  })
})
