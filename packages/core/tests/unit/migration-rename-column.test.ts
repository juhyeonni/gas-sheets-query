/**
 * renameColumn must physically rewrite the header cell (#180).
 *
 * Before this suite, renameColumn was a pure value operation: for every row it
 * moved the value from the old field to the new one through `update()`. On a
 * positional store that is a no-op — the adapter already reads the cell at the
 * new name's position, so the "old" field is never present and the copy
 * condition is never true — and the sheet header keeps the OLD name while the
 * schema declares the new one. Confirmed on the live platform (gas-e2e run
 * 31298563680): v2 renamed nothing and left header `name` vs schema
 * `displayName`.
 *
 * Mirrors the #127 addColumn suite: the store owns the physical operation, the
 * runner delegates to it, the cost never grows with the row count, and a re-run
 * converges instead of rewriting.
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

/** rename `name` -> `displayName`, the shape of the live v2 migration. */
function renameName(from = 'name', to = 'displayName'): Migration[] {
  return [
    {
      version: 1,
      name: 'rename-name',
      up: schema => schema.renameColumn('users', from, to),
      down: schema => schema.renameColumn('users', to, from),
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

describe('renameColumn renames the column for real [#180]', () => {
  it('rewrites the header cell and leaves every data cell where it is', async () => {
    const users = sheetsStore(['id', 'displayName'], [
      ['id', 'name'],
      [1, 'John'],
      [2, 'Jane'],
    ])

    const result = await runnerFor(users, renameName()).migrate()

    expect(result.currentVersion).toBe(1)
    expect(users.getRawData()).toEqual([
      ['id', 'displayName'],
      [1, 'John'],
      [2, 'Jane'],
    ])
  })

  it('renames a mid-schema column without disturbing its neighbours', async () => {
    const users = sheetsStore(['id', 'displayName', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
    ])

    await runnerFor(users, renameName()).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'displayName', 'status'],
      [1, 'John', 'active'],
    ])
    users.clearCache()
    expect(users.findById(1)).toEqual({ id: 1, displayName: 'John', status: 'active' })
  })

  it('keeps reads and writes correct under the post-rename schema', async () => {
    const users = sheetsStore(['id', 'displayName', 'status'], [
      ['id', 'name', 'status'],
      [1, 'John', 'active'],
    ])

    await runnerFor(users, renameName()).migrate()
    users.clearCache()
    users.update(1, { displayName: 'John II' })

    expect(users.getRawData()).toEqual([
      ['id', 'displayName', 'status'],
      [1, 'John II', 'active'],
    ])
  })
})

describe('renameColumn fails loudly when the rename cannot be represented [#180]', () => {
  it('throws UnknownColumnError when the new name is not in the declared schema', async () => {
    // This is also the shape of a rename rolled back against the wrong schema
    // (`down: renameColumn(newName, oldName)` while the store still declares
    // newName). The value-level version of that did not fail — it cleared the
    // source cell and dropped the target, because `objectToRow` only writes
    // declared columns. Silent data loss, replaced by a loud error.
    const users = sheetsStore(['id', 'name'], [
      ['id', 'name'],
      [1, 'John'],
    ])
    const before = users.getRawData()
    const migrationsStore = new MockAdapter<MigrationRecord>()
    const runner = createMigrationRunner({
      migrationsStore,
      storeResolver: resolverFor(users),
      migrations: renameName(),
    })

    const error = await runner.migrate().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MigrationExecutionError)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(UnknownColumnError)
    expect((error as MigrationExecutionError).cause.message).toContain('displayName')

    expect(users.getRawData()).toEqual(before)
    expect(migrationsStore.findAll()).toEqual([])
    expect(runner.getCurrentVersion()).toBe(0)
  })

  it('throws SchemaMismatchError when the header holds neither the old nor the new name', async () => {
    const users = sheetsStore(['id', 'displayName'], [
      ['id', 'email'],
      [1, 'john@test.com'],
    ])
    const before = users.getRawData()
    const runner = runnerFor(users, renameName())

    const error = await runner.migrate().catch((e: unknown) => e)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(SchemaMismatchError)
    expect(users.getRawData()).toEqual(before)
    expect(runner.getCurrentVersion()).toBe(0)
  })

  it('throws SchemaMismatchError when the old name sits at a different physical position', async () => {
    const users = sheetsStore(['id', 'displayName', 'status'], [
      ['id', 'status', 'name'],
      [1, 'active', 'John'],
    ])
    const runner = runnerFor(users, renameName())

    const error = await runner.migrate().catch((e: unknown) => e)
    expect((error as MigrationExecutionError).cause).toBeInstanceOf(SchemaMismatchError)
    expect(runner.getCurrentVersion()).toBe(0)
  })
})

describe('renameColumn is a single header write [#180]', () => {
  it('costs the same bounded number of Sheets calls for 10 and for 1000 rows', async () => {
    const small = sheetsStore(['id', 'displayName'], dataGrid(10))
    let calls = countRangeCalls()
    await runnerFor(small, renameName()).migrate()
    const smallCost = { reads: calls.reads, writes: calls.writes }
    handle?.restore()
    handle = undefined
    vi.restoreAllMocks()

    const large = sheetsStore(['id', 'displayName'], dataGrid(1000))
    calls = countRangeCalls()
    await runnerFor(large, renameName()).migrate()
    const largeCost = { reads: calls.reads, writes: calls.writes }

    expect(largeCost).toEqual(smallCost)
    // One header cell write. Never one write per row.
    expect(largeCost.writes).toBe(1)
    expect(largeCost.reads + largeCost.writes).toBeLessThanOrEqual(4)

    const rows = large.findAll()
    expect(rows).toHaveLength(1000)
    expect(rows.every(row => typeof (row as Record<string, unknown>).displayName === 'string')).toBe(true)
  })
})

describe('renameColumn converges on re-run [#180]', () => {
  it('writes nothing on a second run — the header already reads the new name', async () => {
    const users = sheetsStore(['id', 'displayName'], dataGrid(50))
    await runnerFor(users, renameName()).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countRangeCalls()
    await runnerFor(users, renameName()).migrate()

    expect(calls.writes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })

  it('is a no-op on a sheet the adapter just created with the post-rename header', async () => {
    const users = sheetsStore(['id', 'displayName'], [['id', 'displayName']])

    await runnerFor(users, renameName()).migrate()

    expect(users.getRawData()).toEqual([['id', 'displayName']])
  })
})

describe('renameColumn when both names are declared [#180]', () => {
  it('moves the values instead of rewriting the header — both columns are real', async () => {
    // Deliberate asymmetry with the physical case: the declared schema still
    // owns a `name` column, so its header cell must stay. The operation then
    // means what it means on a name-keyed store — move the value across.
    const users = sheetsStore(['id', 'name', 'label'], [
      ['id', 'name', 'label'],
      [1, 'John', ''],
      [2, 'Jane', 'kept'],
    ])

    await runnerFor(users, renameName('name', 'label')).migrate()

    expect(users.getRawData()).toEqual([
      ['id', 'name', 'label'],
      [1, '', 'John'],
      [2, 'Jane', 'kept'],
    ])
  })

  it('converges: a second run moves nothing', async () => {
    const users = sheetsStore(['id', 'name', 'label'], [
      ['id', 'name', 'label'],
      [1, 'John', ''],
    ])
    await runnerFor(users, renameName('name', 'label')).migrate()
    const afterFirst = users.getRawData()

    users.clearCache()
    const calls = countRangeCalls()
    await runnerFor(users, renameName('name', 'label')).migrate()

    expect(calls.writes).toBe(0)
    expect(users.getRawData()).toEqual(afterFirst)
  })
})

describe('renameColumn keeps the value-level behavior on name-keyed stores [#180]', () => {
  it('moves the value through the runner fallback on MockAdapter', async () => {
    const users = new MockAdapter<RowWithId>({
      initialData: [{ id: 1, name: 'John' } as RowWithId],
    })

    await runnerFor(users, renameName()).migrate()

    const row = users.findById(1) as Record<string, unknown>
    expect(row.displayName).toBe('John')
    expect(row.name).toBeUndefined()
  })
})
