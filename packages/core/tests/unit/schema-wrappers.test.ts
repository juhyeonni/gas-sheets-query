/**
 * Runtime tests for the nullable() / optional() sample wrappers (#200).
 * The type-level behavior is covered by tests/types/schema-wrappers.test-d.ts,
 * which the core typecheck compiles.
 */
import { describe, it, expect } from 'vitest'
import { defineSheetsDB, nullable, optional } from '../../src'

function createMembersDB() {
  return defineSheetsDB({
    tables: {
      members: {
        columns: ['id', 'name', 'deletedAt', 'nickname', 'score'] as const,
        types: {
          id: 0,
          name: '',
          deletedAt: nullable(''),
          nickname: optional(''),
          score: optional(nullable(0))
        }
      }
    },
    mock: true
  })
}

describe('nullable() / optional() sample wrappers', () => {
  it('wrap the sample without changing it', () => {
    expect(nullable('')).toEqual({ kind: 'nullable', sample: '' })
    expect(optional(0)).toEqual({ kind: 'optional', sample: 0 })
    expect(optional(nullable(true))).toEqual({
      kind: 'optional',
      sample: { kind: 'nullable', sample: true }
    })
    expect(Object.isFrozen(nullable(''))).toBe(true)
    expect(Object.isFrozen(optional(''))).toBe(true)
  })

  it('round-trip null and omitted optional values through a mock db', () => {
    const members = createMembersDB().from('members')

    const deleted = members.create({ name: 'Ann', deletedAt: null, score: null })
    const active = members.create({ name: 'Bob', deletedAt: '2024-01-01', nickname: 'bobby', score: 3 })

    const readDeleted = members.findById(deleted.id)
    expect(readDeleted.deletedAt).toBeNull()
    expect(readDeleted.score).toBeNull()
    expect(readDeleted.nickname).toBeUndefined()
    expect('nickname' in readDeleted).toBe(false)

    const readActive = members.findById(active.id)
    expect(readActive).toEqual({ id: active.id, name: 'Bob', deletedAt: '2024-01-01', nickname: 'bobby', score: 3 })
  })

  it('update a nullable column to null and query it back', () => {
    const members = createMembersDB().from('members')
    const row = members.create({ name: 'Cat', deletedAt: '2024-01-01' })

    members.update(row.id, { deletedAt: null })

    const softDeleted = members.query().where('deletedAt', '=', null).exec()
    expect(softDeleted.map(r => r.id)).toEqual([row.id])
  })

  it('leave the store config unchanged: only columns are passed on', () => {
    const db = createMembersDB()
    expect(db.config.tables.members).toEqual({
      columns: ['id', 'name', 'deletedAt', 'nickname', 'score'],
      idColumn: undefined
    })
  })
})
