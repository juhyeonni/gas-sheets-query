/**
 * #192 — Date cells must compare by instant, not object identity.
 *
 * A `date` column deserializes to a Date object, so `where(col, '=',
 * new Date(t))` typechecks and is the documented-correct call — but
 * evaluateCondition compared with `===`, which for two Date objects is
 * reference equality: zero matches, always. Reproduced at runtime on
 * SheetsAdapter (fresh-eyes evaluation, finding M1).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { evaluateCondition } from '../../src/core/query-utils'
import { FakeSpreadsheet, installGasFakes } from '../../src/testing'

const T0 = Date.parse('2026-01-15T10:00:00.000Z')

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('date condition equality (#192)', () => {
  it('= and != match Dates by instant', () => {
    const row = { id: 1, when: new Date(T0) }
    expect(evaluateCondition(row, { field: 'when', operator: '=', value: new Date(T0) })).toBe(true)
    expect(evaluateCondition(row, { field: 'when', operator: '!=', value: new Date(T0) })).toBe(false)
    expect(evaluateCondition(row, { field: 'when', operator: '=', value: new Date(T0 + 1) })).toBe(false)
  })

  it('in finds a Date among Date candidates', () => {
    const row = { id: 1, when: new Date(T0) }
    expect(
      evaluateCondition(row, { field: 'when', operator: 'in', value: [new Date(T0 - 1), new Date(T0)] })
    ).toBe(true)
  })

  it('range operators keep working on Dates', () => {
    const row = { id: 1, when: new Date(T0) }
    expect(evaluateCondition(row, { field: 'when', operator: '>', value: new Date(T0 - 1) })).toBe(true)
    expect(evaluateCondition(row, { field: 'when', operator: '<=', value: new Date(T0) })).toBe(true)
  })

  it('the live repro: SheetsAdapter date column queried with a fresh Date', () => {
    const handle = installGasFakes({ spreadsheets: { S: new FakeSpreadsheet('S') }, activeId: 'S' })
    restore = () => handle.restore()

    interface Row {
      id: number
      happenedAt: Date | string
      [key: string]: unknown
    }
    const adapter = new SheetsAdapter<Row>({
      spreadsheetId: 'S',
      sheetName: 'events',
      columns: ['id', 'happenedAt'],
      columnTypes: { happenedAt: 'date' }
    })
    adapter.insert({ happenedAt: new Date(T0) })

    const hits = adapter.find({
      where: [{ field: 'happenedAt', operator: '=', value: new Date(T0) }],
      orderBy: []
    })
    expect(hits).toHaveLength(1)
  })
})
