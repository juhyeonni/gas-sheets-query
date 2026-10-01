/**
 * #238 - data-sized Math.max(...xs) / Math.min(...xs) spreads throw
 * RangeError once the array is large enough. These tests use 200k rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { createQueryBuilder } from '../../src/core/query-builder'
import { installGasFakes, fromArrays } from '../../src/testing'

const N = 200_000

function idRows(): { id: number }[] {
  return Array.from({ length: N }, (_, i) => ({ id: i + 1 }))
}

let restore: (() => void) | undefined

afterEach(() => {
  restore?.()
  restore = undefined
})

describe('large-array extremes (#238)', () => {
  it('MockAdapter constructor computes nextId over 200k rows', () => {
    const adapter = new MockAdapter<{ id: number }>({ initialData: idRows() })
    expect(adapter.insert({}).id).toBe(N + 1)
  })

  it('MockAdapter.reset computes nextId over 200k rows', () => {
    const adapter = new MockAdapter<{ id: number }>()
    adapter.reset(idRows())
    expect(adapter.insert({}).id).toBe(N + 1)
  })

  it('QueryBuilder min/max/agg over 200k numeric values', () => {
    const rows = Array.from({ length: N }, (_, i) => ({ id: i + 1, v: i - 100_000 }))
    const adapter = new MockAdapter<{ id: number; v: number }>({ initialData: rows })
    const qb = () => createQueryBuilder(adapter)
    expect(qb().min('v')).toBe(-100_000)
    expect(qb().max('v')).toBe(99_999)
    expect(qb().agg({ lo: 'min:v', hi: 'max:v' })).toEqual([{ lo: -100_000, hi: 99_999 }])
  })

  it('SheetsAdapter auto-id insert over a 200k-row sheet', () => {
    const grid: unknown[][] = [['id', 'name']]
    for (let i = 1; i <= N; i++) grid.push([i, 'x'])
    const ss = fromArrays({ users: grid }, 'S')
    const handle = installGasFakes({ spreadsheets: { S: ss }, activeId: 'S' })
    restore = () => handle.restore()
    const adapter = new SheetsAdapter<{ id: number; name: string }>({
      spreadsheetId: 'S',
      sheetName: 'users',
      columns: ['id', 'name'],
    })
    expect(adapter.insert({ name: 'n' }).id).toBe(N + 1)
  })
})
