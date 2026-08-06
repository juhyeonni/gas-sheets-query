/**
 * Column conversion helpers (#135)
 */
import { describe, it, expect } from 'vitest'
import { deserializeColumnValue, deserializeRow } from '../../src/index'
import type { ColumnType } from '../../src/index'

describe('deserializeColumnValue', () => {
  it('parses ISO strings into Date for date columns', () => {
    const value = deserializeColumnValue('2024-03-01T10:00:00.000Z', 'date')
    expect(value).toBeInstanceOf(Date)
    expect((value as Date).toISOString()).toBe('2024-03-01T10:00:00.000Z')
  })

  it('passes an existing Date through unchanged (idempotent)', () => {
    const date = new Date('2024-03-01T10:00:00.000Z')
    expect(deserializeColumnValue(date, 'date')).toBe(date)
  })

  it('leaves an unparseable date value as-is', () => {
    expect(deserializeColumnValue('not-a-date', 'date')).toBe('not-a-date')
  })

  it('parses JSON for array and object columns', () => {
    expect(deserializeColumnValue('["a","b"]', 'string[]')).toEqual(['a', 'b'])
    expect(deserializeColumnValue('[1,2]', 'number[]')).toEqual([1, 2])
    expect(deserializeColumnValue('{"k":1}', 'object')).toEqual({ k: 1 })
  })

  it('returns type-appropriate empty values for blank cells', () => {
    expect(deserializeColumnValue('', 'string[]')).toEqual([])
    expect(deserializeColumnValue(null, 'object')).toBeNull()
    expect(deserializeColumnValue(undefined, 'boolean')).toBe(false)
    expect(deserializeColumnValue('', 'number')).toBe(0)
  })

  it('coerces boolean and number columns', () => {
    expect(deserializeColumnValue('TRUE', 'boolean')).toBe(true)
    expect(deserializeColumnValue('false', 'boolean')).toBe(false)
    expect(deserializeColumnValue('42', 'number')).toBe(42)
  })
})

describe('deserializeRow', () => {
  const columnTypes: Record<string, ColumnType> = {
    startsAt: 'date',
    tags: 'string[]',
  }

  it('converts every declared column', () => {
    const row = deserializeRow(
      { id: 'e1', title: 'Launch', startsAt: '2024-03-01T10:00:00.000Z', tags: '["a"]' },
      columnTypes
    )

    expect(row.startsAt).toBeInstanceOf(Date)
    expect(row.tags).toEqual(['a'])
    expect(row.title).toBe('Launch')
  })

  it('returns the same object when no column types are declared', () => {
    const row = { id: 'e1', startsAt: '2024-03-01T10:00:00.000Z' }
    expect(deserializeRow(row, undefined)).toBe(row)
    expect(deserializeRow(row, {})).toBe(row)
  })

  it('returns the same object when nothing needed converting', () => {
    const row = { id: 'e1', startsAt: new Date(0), tags: ['a'] }
    expect(deserializeRow(row, columnTypes)).toBe(row)
  })

  it('does not invent columns absent from the row', () => {
    const row = deserializeRow({ id: 'e1' }, columnTypes)
    expect('tags' in row).toBe(false)
    expect('startsAt' in row).toBe(false)
  })

  it('does not mutate the input row', () => {
    const row = { id: 'e1', startsAt: '2024-03-01T10:00:00.000Z' }
    const converted = deserializeRow(row, columnTypes)
    expect(row.startsAt).toBe('2024-03-01T10:00:00.000Z')
    expect(converted).not.toBe(row)
  })
})
