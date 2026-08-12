/**
 * export.ts unit tests — toGrid / toCsv / toJson.
 * Fidelity oracle: story 005-snapshot-export.
 */
import { describe, it, expect } from 'vitest'
import { toGrid, toCsv, toJson } from '../../src/testing/export'
import { fromArrays, fromCsv, fromJson } from '../../src/testing/loaders'

describe('toGrid', () => {
  it('returns a rectangular, defensively-copied grid', () => {
    const sheet = fromArrays({ S: [['a', 'b'], [1, 2]] }).getSheetByName('S')!
    const grid = toGrid(sheet)

    grid[0][0] = 'MUTATED'
    expect(toGrid(sheet)[0][0]).toBe('a')
  })

  it('returns [] for an empty sheet', () => {
    const sheet = fromArrays({ S: [] }).getSheetByName('S')!
    expect(toGrid(sheet)).toEqual([])
  })

  it('pads jagged internal rows to rectangular', () => {
    const sheet = fromArrays({ S: [['a'], ['b', 'c', 'd']] }).getSheetByName('S')!
    expect(toGrid(sheet)).toEqual([
      ['a', '', ''],
      ['b', 'c', 'd']
    ])
  })
})

describe('toCsv', () => {
  it('round-trips through fromCsv (coercion on) equivalently', () => {
    const sheet = fromCsv(
      'People',
      'name,age,active,joined\nAlice,30,TRUE,2024-01-15T10:30:00.000Z\nBob,25,FALSE,2024-02-20T08:00:00.000Z'
    )
    const csv = toCsv(sheet)
    const reloaded = fromCsv('People2', csv)

    expect(toGrid(reloaded)).toEqual(toGrid(sheet))
  })

  it('applies RFC 4180 quoting for commas, quotes, and newlines', () => {
    const sheet = fromArrays({ S: [['hello, world', 'she said "hi"', 'line1\nline2']] }).getSheetByName('S')!
    expect(toCsv(sheet)).toBe('"hello, world","she said ""hi""","line1\nline2"')
  })

  it('serializes booleans as TRUE/FALSE', () => {
    const sheet = fromArrays({ S: [[true, false]] }).getSheetByName('S')!
    expect(toCsv(sheet)).toBe('TRUE,FALSE')
  })

  it('returns an empty string for an empty sheet', () => {
    const sheet = fromArrays({ S: [] }).getSheetByName('S')!
    expect(toCsv(sheet)).toBe('')
  })
})

describe('toJson', () => {
  it('round-trips Date cells and empty-cell positions exactly through fromJson', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    const ss = fromArrays({ Sheet1: [['a', ''], [date, 'x']] })

    const reloaded = fromJson(toJson(ss))
    const original = ss.getSheetByName('Sheet1')!
    const restored = reloaded.getSheetByName('Sheet1')!

    expect(toGrid(restored)[0]).toEqual(toGrid(original)[0])
    expect(toGrid(restored)[1][0]).toBeInstanceOf(Date)
    expect((toGrid(restored)[1][0] as Date).getTime()).toBe(date.getTime())
    expect(toGrid(restored)[1][1]).toBe('x')
  })

  it('produces a versioned envelope with all sheets', () => {
    const ss = fromArrays({ A: [['x']], B: [['y']] })
    const envelope = JSON.parse(toJson(ss))

    expect(envelope.version).toBe(1)
    expect(Object.keys(envelope.sheets)).toEqual(['A', 'B'])
  })
})
