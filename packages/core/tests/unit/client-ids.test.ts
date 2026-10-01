import { describe, it, expect } from 'vitest'
import { assertClientIdsAvailable } from '../../src/core/client-ids'
import { DuplicateIdError } from '../../src/core/errors'

const IDS: Array<string | number> = [
  1, '1', 0, -0, '0', '-0', '01', 1.5, '1.5', '1e3', 1000, NaN, 'NaN',
  Infinity, 'Infinity', ' 1', '', 'abc',
]

describe('assertClientIdsAvailable (#235)', () => {
  it('matches the String-equality collision rule exhaustively', () => {
    for (const stored of IDS) {
      for (const candidate of IDS) {
        const idIndex = new Map<string | number, number>([[stored, 0]])
        const collides = String(stored) === String(candidate)
        const run = () => assertClientIdsAvailable(idIndex, [candidate])
        if (collides) {
          expect(run, `${String(stored)} vs ${String(candidate)}`).toThrow(DuplicateIdError)
        } else {
          expect(run, `${String(stored)} vs ${String(candidate)}`).not.toThrow()
        }
      }
    }
  })

  it('rejects in-batch duplicates and carries id and tableName', () => {
    const empty = new Map<string | number, number>()
    try {
      assertClientIdsAvailable(empty, [1, '1'])
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateIdError)
      expect((e as DuplicateIdError).id).toBe('1')
    }
    expect(() => assertClientIdsAvailable(empty, ['a', 'b'])).not.toThrow()

    try {
      assertClientIdsAvailable(new Map([['x', 0]]), ['x'], 'T')
      expect.unreachable()
    } catch (e) {
      expect((e as DuplicateIdError).tableName).toBe('T')
      expect((e as DuplicateIdError).code).toBe('DUPLICATE_ID')
    }
  })
})
