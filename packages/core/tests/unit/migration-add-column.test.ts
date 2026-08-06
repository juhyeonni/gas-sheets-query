/**
 * addColumn must physically add the column and back it up with a single ranged
 * write (#127).
 *
 * Before this suite, addColumn was a pure value backfill over findAll() +
 * update(): if the column was not already in the sheet header, objectToRow
 * dropped the key on write, so the sheet was untouched while the migration
 * record was inserted and getCurrentVersion() advanced — a silent no-op
 * reporting success. The backfill also cost ~4 Sheets API calls per row and,
 * with no default, rewrote every row on every run instead of converging.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createMigrationRunner } from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { MigrationExecutionError } from '../../src/core/migration'
import { SchemaMismatchError, UnknownColumnError } from '../../src/core/errors'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { FakeRange } from '../../src/testing/fake-sheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'
import type { DataStore, Row, RowWithId } from '../../src/core/types'

const SPREADSHEET_ID = 'test-spreadsheet-id'

let handle: GasFakesHandle | undefined

afterEach(() => {
  handle?.restore()
  handle = undefined
  vi.restoreAllMocks()
})

/** Install a fake spreadsheet with one Users sheet and return a positional adapter over it. */
function sheetsStore(columns: string[], grid: unknown[][]): SheetsAdapter<RowWithId> {
  const spreadsheet = fromArrays({ Users: grid })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
  return new SheetsAdapter<RowWithId>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Users',
    columns,
  })
}

function resolverFor(store: DataStore<RowWithId>): StoreResolver {
  return <T extends Row>() => store as unknown as DataStore<T>
}

function addStatus(options?: { default?: unknown }): Migration[] {
  return [
    {
      version: 1,
      name: 'add-status',
      up: schema => schema.addColumn('users', 'status', options),
      down: schema => schema.removeColumn('users', 'status'),
    },
  ]
}

function runnerFor(store: DataStore<RowWithId>, migrations: Migration[]) {
  return createMigrationRunner({
    migrationsStore: new MockAdapter<MigrationRecord>(),
    storeResolver: resolverFor(store),
    migrations,
  })
}

/** Count Range-level Sheets calls, the unit that maps to a real API round trip. */
function countRangeCalls() {
  const getValues = vi.spyOn(FakeRange.prototype, 'getValues')
  const setValues = vi.spyOn(FakeRange.prototype, 'setValues')
  return {
    get reads() {
      return getValues.mock.calls.length
    },
    get writes() {
      return setValues.mock.calls.length
    },
    reset() {
      getValues.mockClear()
      setValues.mockClear()
    },
  }
}

function dataGrid(rowCount: number): unknown[][] {
  const rows: unknown[][] = [['id', 'name']]
  for (let i = 1; i <= rowCount; i++) rows.push([i, `user-${i}`])
  return rows
}

describe('addColumn adds the column for real [#127]', () => {
  it('writes the header and backfills the default when the column is missing from the sheet', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name'],
      [1, 'John'],
      [2, 'Jane'],
    ])

    const result = await runnerFor(users, addStatus({ default: 'unknown' })).migrate()

    expect(result.currentVersion).toBe(1)
    expect(users.getRawData()).toEqual([
      ['id', 'name', 'status'],
      [1, 'John', 'unknown'],
      [2, 'Jane', 'unknown'],
    ])
  })

  it('inserts a mid-schema column without shifting existing row data out of alignment', async () => {
    const users = sheetsStore(['id', 'status', 'name'], [
      ['id', 'name'],
      [1, 'John'],
    ])

    await runnerFor(users, addStatus({ default: 'unknown' })).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'status', 'name'],
      [1, 'unknown', 'John'],
    ])
    users.clearCache()
    expect(users.findById(1)).toEqual({ id: 1, status: 'unknown', name: 'John' })
  })

  it('adds the header even when there is no default and no data rows', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [['id', 'name']])

    await runnerFor(users, addStatus()).migrate()

    expect(users.getRawData()).toEqual([['id', 'name', 'status']])
  })
})

describe('addColumn fails loudly when the column cannot be stored [#127]', () => {
  it('throws UnknownColumnError and leaves the sheet and the version untouched', async () => {
    const users = sheetsStore(['id', 'name'], [
      ['id', 'name'],
      [1, 'John'],
    ])
    const before = users.getRawData()
    const migrationsStore = new MockAdapter<MigrationRecord>()
    const runner = createMigrationRunner({
      migrationsStore,
      storeResolver: resolverFor(users),
      migrations: addStatus({ default: 'unknown' }),
    })

    await expect(runner.migrate()).rejects.toThrow(MigrationExecutionError)

    const error = await runner.migrate().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MigrationExecutionError)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(UnknownColumnError)
    expect((error as MigrationExecutionError).cause.message).toContain('status')

    expect(users.getRawData()).toEqual(before)
    expect(migrationsStore.findAll()).toEqual([])
    expect(runner.getCurrentVersion()).toBe(0)
  })

  it('throws SchemaMismatchError when the sheet header does not match the declared schema', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'email'],
      [1, 'john@test.com'],
    ])
    const runner = runnerFor(users, addStatus({ default: 'unknown' }))

    const error = await runner.migrate().catch((e: unknown) => e)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(SchemaMismatchError)
    expect(runner.getCurrentVersion()).toBe(0)
  })

  it('throws SchemaMismatchError when the column sits at a different physical position', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'status', 'name'],
      [1, 'active', 'John'],
    ])
    const runner = runnerFor(users, addStatus({ default: 'unknown' }))

    const error = await runner.migrate().catch((e: unknown) => e)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(SchemaMismatchError)
    expect(runner.getCurrentVersion()).toBe(0)
  })
})

describe('addColumn backfill is a single ranged write [#127]', () => {
  it('costs the same bounded number of Sheets calls for 10 and for 1000 rows', async () => {
    const small = sheetsStore(['id', 'name', 'status'], dataGrid(10))
    let calls = countRangeCalls()
    await runnerFor(small, addStatus({ default: 'unknown' })).migrate()
    const smallCost = { reads: calls.reads, writes: calls.writes }
    handle?.restore()
    handle = undefined
    vi.restoreAllMocks()

    const large = sheetsStore(['id', 'name', 'status'], dataGrid(1000))
    calls = countRangeCalls()
    await runnerFor(large, addStatus({ default: 'unknown' })).migrate()
    const largeCost = { reads: calls.reads, writes: calls.writes }

    expect(largeCost).toEqual(smallCost)
    // Header write + one bulk column write. Never one write per row.
    expect(largeCost.writes).toBeLessThanOrEqual(2)
    expect(largeCost.reads + largeCost.writes).toBeLessThanOrEqual(6)

    const rows = large.findAll()
    expect(rows).toHaveLength(1000)
    expect(rows.every(row => (row as Record<string, unknown>).status === 'unknown')).toBe(true)
  })

  it('uses one batchUpdate instead of one update per row on name-keyed stores', async () => {
    const users = new MockAdapter<RowWithId>({
      initialData: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })
    const batchUpdate = vi.spyOn(users, 'batchUpdate')
    const update = vi.spyOn(users, 'update')

    await runnerFor(users, addStatus({ default: 'unknown' })).migrate()

    expect(batchUpdate).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(users.findAll().every(row => (row as Record<string, unknown>).status === 'unknown')).toBe(true)
  })
})

describe('addColumn converges on re-run [#127]', () => {
  it('writes nothing on a second run when there is no default', async () => {
    const users = sheetsStore(['id', 'name', 'status'], dataGrid(50))
    await runnerFor(users, addStatus()).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countRangeCalls()
    await runnerFor(users, addStatus()).migrate()

    expect(calls.writes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })

  it('writes nothing on a second run when the default is already backfilled', async () => {
    const users = sheetsStore(['id', 'name', 'status'], dataGrid(50))
    await runnerFor(users, addStatus({ default: 'unknown' })).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countRangeCalls()
    await runnerFor(users, addStatus({ default: 'unknown' })).migrate()

    expect(calls.writes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })

  it('leaves rows that already have a value untouched and fills only the empty ones', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
      [2, 'Jane', ''],
    ])

    await runnerFor(users, addStatus({ default: 'unknown' })).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
      [2, 'Jane', 'unknown'],
    ])
  })
})
