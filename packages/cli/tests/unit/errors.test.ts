/**
 * Tests for toError utility
 */
import { describe, it, expect } from 'vitest'
import { toError } from '../../src/utils/errors.js'

describe('toError', () => {
  it('should return the same Error instance if given an Error', () => {
    const err = new Error('test error')
    const result = toError(err)

    expect(result).toBe(err)
    expect(result.message).toBe('test error')
  })

  it('should wrap a string into an Error', () => {
    const result = toError('string error')

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('string error')
  })

  it('should wrap a number into an Error', () => {
    const result = toError(42)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('42')
  })

  it('should wrap null into an Error', () => {
    const result = toError(null)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('null')
  })

  it('should wrap undefined into an Error', () => {
    const result = toError(undefined)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('undefined')
  })

  it('should wrap an object into an Error', () => {
    const result = toError({ code: 'ENOENT' })

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('[object Object]')
  })

  it('should preserve Error subclasses', () => {
    const err = new TypeError('type error')
    const result = toError(err)

    expect(result).toBe(err)
    expect(result).toBeInstanceOf(TypeError)
  })
})
