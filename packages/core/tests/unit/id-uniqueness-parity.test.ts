/**
 * Client-mode id uniqueness must behave identically on every adapter (#154).
 *
 * SheetsAdapter rejects a client-supplied id that already exists — or repeats
 * inside one batch — with DuplicateIdError (#128). MockAdapter is the
 * documented test double, so code that passes against it must not throw in
 * production: the same scenarios run here against both stores and the results
 * are asserted to agree. LocalAdapter is pinned to the same list in
 * `packages/client/tests/unit/local/id-uniqueness.test.ts` (it lives in another
 * package and pulls in IndexedDB/MutationQueue plumbing).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { DuplicateIdError } from '../../src/core/errors'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'
import type { DataStore, IdMode, RowWithId } from '../../src/core/types'

const SPREADSHEET_ID = 'test-spreadsheet-id'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name']

interface TestRow extends RowWithId {
  id: string | number
  name: string
}

/** DataStore leaves batchInsert optional; every adapter under test implements it. */
type BatchingStore<T extends RowWithId> = DataStore<T> & {
  batchInsert(data: (T | Omit<T, 'id'>)[]): T[]
}

/** One adapter under test, plus a way to read back what it actually stored. */
interface Harness {
  store: BatchingStore<TestRow>
  /** Ids currently stored, normalized to strings so adapters compare equal. */
  ids(): string[]
}

type HarnessFactory = (idMode: IdMode, seed: TestRow[]) => Harness

let gasFakes: GasFakesHandle | undefined

afterEach(() => {
  gasFakes?.restore()
  gasFakes = undefined
})

const mockHarness: HarnessFactory = (idMode, seed) => {
  const store = new MockAdapter<TestRow>({ initialData: seed, idMode })
  return { store, ids: () => store.findAll().map(row => String(row.id)) }
}

const sheetsHarness: HarnessFactory = (idMode, seed) => {
  const grid: unknown[][] = [COLUMNS, ...seed.map(row => [row.id, row.name])]
  gasFakes = installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: fromArrays({ [SHEET_NAME]: grid }) },
    activeId: SPREADSHEET_ID,
  })
  const store = new SheetsAdapter<TestRow>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS,
    idMode,
  })
  return { store, ids: () => store.findAll().map(row => String(row.id)) }
}

const ADAPTERS: [name: string, factory: HarnessFactory][] = [
  ['MockAdapter', mockHarness],
  ['SheetsAdapter', sheetsHarness],
]

describe.each(ADAPTERS)('%s client-mode id uniqueness [#154]', (_name, createHarness) => {
  const client = (seed: TestRow[] = []) => createHarness('client', seed)

  it('insert() rejects an id that already exists', () => {
    const { store, ids } = client([{ id: 'a', name: 'Alice' }])

    expect(() => store.insert({ id: 'a', name: 'Clone' })).toThrow(DuplicateIdError)
    expect(ids()).toEqual(['a'])
  })

  it('insert() matches ids across string/number representations', () => {
    const { store, ids } = client([{ id: 7, name: 'Alice' }])

    expect(() => store.insert({ id: '7', name: 'Clone' })).toThrow(DuplicateIdError)
    expect(ids()).toEqual(['7'])
  })

  it('carries the offending id and a stable error code', () => {
    const { store } = client([{ id: 'a', name: 'Alice' }])

    try {
      store.insert({ id: 'a', name: 'Clone' })
      expect.unreachable('insert should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateIdError)
      expect((error as DuplicateIdError).id).toBe('a')
      expect((error as DuplicateIdError).code).toBe('DUPLICATE_ID')
    }
  })

  it('batchInsert() writes nothing when one id already exists', () => {
    const { store, ids } = client([{ id: 'a', name: 'Alice' }])

    expect(() =>
      store.batchInsert([
        { id: 'b', name: 'Bob' },
        { id: 'a', name: 'Clone' },
      ])
    ).toThrow(DuplicateIdError)
    expect(ids()).toEqual(['a'])
  })

  it('batchInsert() rejects ids duplicated within the same batch', () => {
    const { store, ids } = client()

    expect(() =>
      store.batchInsert([
        { id: 'a', name: 'Alice' },
        { id: 'a', name: 'Clone' },
      ])
    ).toThrow(DuplicateIdError)
    expect(ids()).toEqual([])
  })

  it('batchInsert() writes nothing when a later item omits its id', () => {
    const { store, ids } = client()

    expect(() =>
      store.batchInsert([
        { id: 'a', name: 'Alice' },
        { name: 'No id' } as Omit<TestRow, 'id'>,
      ])
    ).toThrow(/ID is required/)
    expect(ids()).toEqual([])
  })

  it('still accepts distinct ids', () => {
    const { store, ids } = client()

    store.insert({ id: 'a', name: 'Alice' })
    store.batchInsert([
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Carol' },
    ])

    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('frees an id again after the row is deleted', () => {
    const { store, ids } = client([{ id: 'a', name: 'Alice' }])

    expect(store.delete('a')).toBe(true)
    expect(() => store.insert({ id: 'a', name: 'Reused' })).not.toThrow()
    expect(ids()).toEqual(['a'])
    expect(store.findById('a')?.name).toBe('Reused')
  })

  it('leaves auto mode unaffected: caller ids are ignored, not rejected', () => {
    const { store, ids } = createHarness('auto', [])

    store.insert({ id: 1, name: 'Alice' })
    store.insert({ id: 1, name: 'Bob' })
    store.batchInsert([{ id: 1, name: 'Carol' }])

    expect(ids()).toEqual(['1', '2', '3'])
  })
})
