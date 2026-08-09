/**
 * removeColumn must physically delete the column (#180).
 *
 * Before this suite, removeColumn was a pure value operation: it cleared each
 * row's cell through `update()` and left the physical column — header and all —
 * in place. On a positional store that leaves a ghost column behind, and the
 * NEXT deploy, whose schema no longer declares it, maps every column to its
 * right one position off: reads return the neighbour's value and writes land in
 * the abandoned column. Confirmed on the live platform (gas-e2e run
 * 31298563680).
 *
 * Mirrors the #127 addColumn suite: the store owns the physical operation, the
 * runner delegates to it, the cost never grows with the row count, and a re-run
 * converges instead of rewriting.
 *
 * `removeColumn` is destructive by contract — the deleted cells are gone, and
 * no rollback can bring them back.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createMigrationRunner } from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { MigrationExecutionError } from '../../src/core/migration'
import { SchemaMismatchError } from '../../src/core/errors'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { FakeRange, FakeSheet } from '../../src/testing/fake-sheet'
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

function dropLegacy(column = 'legacy'): Migration[] {
  return [
    {
      version: 1,
      name: 'drop-legacy',
      up: schema => schema.removeColumn('users', column),
      down: schema => schema.addColumn('users', column),
    },
  ]
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

/** Count the Sheets calls that map to a real API round trip, including the structural delete. */
function countSheetsCalls() {
  const getValues = vi.spyOn(FakeRange.prototype, 'getValues')
  const setValues = vi.spyOn(FakeRange.prototype, 'setValues')
  const deleteColumn = vi.spyOn(FakeSheet.prototype, 'deleteColumn')
  return {
    get reads() {
      return getValues.mock.calls.length
    },
    get writes() {
      return setValues.mock.calls.length
    },
    get deletes() {
      return deleteColumn.mock.calls.length
    },
  }
}

function dataGrid(rowCount: number): unknown[][] {
  const rows: unknown[][] = [['id', 'legacy', 'name']]
  for (let i = 1; i <= rowCount; i++) rows.push([i, `L${i}`, `user-${i}`])
  return rows
}

describe('removeColumn deletes the column for real [#180]', () => {
  it('deletes the physical column and keeps the remaining data under its own headers', async () => {
    const users = sheetsStore(['id', 'name'], [
      ['id', 'legacy', 'name'],
      [1, 'L1', 'John'],
      [2, 'L2', 'Jane'],
    ])

    const result = await runnerFor(users, dropLegacy()).migrate()

    expect(result.currentVersion).toBe(1)
    expect(users.getRawData()).toEqual([
      ['id', 'name'],
      [1, 'John'],
      [2, 'Jane'],
    ])
  })

  it('keeps reads and writes correct under the post-removal schema', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'legacy', 'name', 'status'],
      [1, 'L1', 'John', 'active'],
      [2, 'L2', 'Jane', 'archived'],
    ])

    await runnerFor(users, dropLegacy()).migrate()

    users.clearCache()
    expect(users.findById(1)).toEqual({ id: 1, name: 'John', status: 'active' })
    users.update(2, { status: 'live' })
    expect(users.getRawData()).toEqual([
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
      [2, 'Jane', 'live'],
    ])
  })

  it('deletes a trailing column too', async () => {
    const users = sheetsStore(['id', 'name'], [
      ['id', 'name', 'legacy'],
      [1, 'John', 'L1'],
    ])

    await runnerFor(users, dropLegacy()).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'name'],
      [1, 'John'],
    ])
  })
})

describe('removeColumn fails loudly when the layout contradicts the schema [#180]', () => {
  it('throws SchemaMismatchError when the remaining header would not be the declared schema', async () => {
    const users = sheetsStore(['id', 'name'], [
      ['id', 'legacy', 'email'],
      [1, 'L1', 'john@test.com'],
    ])
    const before = users.getRawData()
    const migrationsStore = new MockAdapter<MigrationRecord>()
    const runner = createMigrationRunner({
      migrationsStore,
      storeResolver: resolverFor(users),
      migrations: dropLegacy(),
    })

    const error = await runner.migrate().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MigrationExecutionError)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(SchemaMismatchError)

    expect(users.getRawData()).toEqual(before)
    expect(migrationsStore.findAll()).toEqual([])
    expect(runner.getCurrentVersion()).toBe(0)
  })
})

describe('removeColumn is a single structural call [#180]', () => {
  it('costs the same bounded number of Sheets calls for 10 and for 1000 rows', async () => {
    const small = sheetsStore(['id', 'name'], dataGrid(10))
    let calls = countSheetsCalls()
    await runnerFor(small, dropLegacy()).migrate()
    const smallCost = { reads: calls.reads, writes: calls.writes, deletes: calls.deletes }
    handle?.restore()
    handle = undefined
    vi.restoreAllMocks()

    const large = sheetsStore(['id', 'name'], dataGrid(1000))
    calls = countSheetsCalls()
    await runnerFor(large, dropLegacy()).migrate()
    const largeCost = { reads: calls.reads, writes: calls.writes, deletes: calls.deletes }

    expect(largeCost).toEqual(smallCost)
    // One structural delete removes the values with it — no per-row clearing.
    expect(largeCost.deletes).toBe(1)
    expect(largeCost.writes).toBe(0)
    expect(largeCost.reads).toBeLessThanOrEqual(2)

    const rows = large.findAll()
    expect(rows).toHaveLength(1000)
    expect(rows.every(row => !('legacy' in (row as Record<string, unknown>)))).toBe(true)
  })
})

describe('removeColumn converges on re-run [#180]', () => {
  it('is a no-op once the column is gone from the sheet', async () => {
    const users = sheetsStore(['id', 'name'], dataGrid(50))
    await runnerFor(users, dropLegacy()).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countSheetsCalls()
    await runnerFor(users, dropLegacy()).migrate()

    expect(calls.writes).toBe(0)
    expect(calls.deletes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })
})

describe('removeColumn on a column the schema still declares [#180]', () => {
  it('clears the values with one ranged write instead of dropping the column', async () => {
    // The declared columns are this store's positional map. Dropping a column
    // it still declares would shift every column to the right of it under the
    // wrong header, so the values are cleared and the layout is kept — the
    // physical delete happens under the schema that no longer declares it.
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
      [2, 'Jane', ''],
    ])

    const calls = countSheetsCalls()
    await runnerFor(users, dropLegacy('status')).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'name', 'status'],
      [1, 'John', ''],
      [2, 'Jane', ''],
    ])
    expect(calls.deletes).toBe(0)
    expect(calls.writes).toBe(1)
  })

  it('converges: a second run clears nothing', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
    ])
    await runnerFor(users, dropLegacy('status')).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countSheetsCalls()
    await runnerFor(users, dropLegacy('status')).migrate()

    expect(calls.writes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })

  it('still supports rolling back an addColumn against the schema that declares it', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', ''],
    ])
    const runner = runnerFor(users, addStatus({ default: 'unknown' }))

    await runner.migrate()
    await runner.rollback()

    expect(users.getRawData()).toEqual([
      ['id', 'name', 'status'],
      [1, 'John', ''],
    ])
    expect(runner.getCurrentVersion()).toBe(0)
  })

  it('is a no-op when the declared column is not on the sheet yet', async () => {
    const users = sheetsStore(['id', 'name', 'status'], [
      ['id', 'name'],
      [1, 'John'],
    ])

    const calls = countSheetsCalls()
    await runnerFor(users, dropLegacy('status')).migrate()

    expect(calls.writes).toBe(0)
    expect(calls.deletes).toBe(0)
    expect(users.getRawData()).toEqual([
      ['id', 'name'],
      [1, 'John'],
    ])
  })
})

describe('removeColumn keeps the value-level behavior on name-keyed stores [#180]', () => {
  it('clears the value through the runner fallback on MockAdapter', async () => {
    const users = new MockAdapter<RowWithId>({
      initialData: [{ id: 1, legacy: 'L1' } as RowWithId],
    })

    await runnerFor(users, dropLegacy()).migrate()

    expect((users.findById(1) as Record<string, unknown>).legacy).toBeUndefined()
  })
})
