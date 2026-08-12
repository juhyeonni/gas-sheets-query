/**
 * batchUpdate must honour the same id-immutability guard update() got (#98),
 * in both adapters (#113). Without it MockAdapter leaves a ghost row (reachable
 * only at the old id) while SheetsAdapter genuinely rewrites the key cell — the
 * exact mock-vs-sheets divergence #98 was filed to remove.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'

interface Row {
  id: number
  name: string
}

const SPREADSHEET_ID = 'test-spreadsheet-id'

function createSheetsAdapter(): SheetsAdapter<Row> {
  const ss = fromArrays({
    Users: [
      ['id', 'name'],
      [1, 'a'],
      [2, 'b'],
    ],
  })
  installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: ss }, activeId: SPREADSHEET_ID })
  return new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Users',
    columns: ['id', 'name'],
  })
}

describe('batchUpdate id immutability [#113]', () => {
  let mock: MockAdapter<Row>

  beforeEach(() => {
    mock = new MockAdapter<Row>({
      initialData: [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ],
    })
  })

  it('MockAdapter ignores an id in the update payload', () => {
    const [updated] = mock.batchUpdate([
      { id: 1, data: { id: 99, name: 'z' } as Partial<Row> },
    ])

    expect(updated.id).toBe(1)
    expect(updated.name).toBe('z')
    expect(mock.findById(1)?.name).toBe('z')
    expect(mock.findById(99)).toBeUndefined()
  })

  it('SheetsAdapter ignores an id in the update payload', () => {
    const sheets = createSheetsAdapter()

    const [updated] = sheets.batchUpdate([
      { id: 1, data: { id: 99, name: 'z' } as Partial<Row> },
    ])

    expect(updated.id).toBe(1)
    expect(updated.name).toBe('z')

    sheets.clearCache()
    expect(sheets.findById(1)?.name).toBe('z')
    expect(sheets.findById(99)).toBeUndefined()
    expect(sheets.getRawData()).toEqual([
      ['id', 'name'],
      [1, 'z'],
      [2, 'b'],
    ])
  })

  it('does not let two rows collide onto one id', () => {
    mock.batchUpdate([{ id: 1, data: { id: 2 } as Partial<Row> }])

    const ids = mock.findAll().map(r => r.id)
    expect(ids).toEqual([1, 2])
  })
})
