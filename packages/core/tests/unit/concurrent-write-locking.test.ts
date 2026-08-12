/**
 * Concurrency tests for the SheetsAdapter write paths and the MigrationRunner
 * (#128).
 *
 * GAS runs concurrent executions against the same spreadsheet, so every
 * read-then-write sequence must be held inside one script lock. These tests
 * model a second execution by driving TWO adapter instances over ONE shared
 * FakeSheet and firing the second one from inside the first one's operation,
 * at the exact point where the interleaving is harmful.
 *
 * The fake `LockService` here is exclusive (unlike the always-available no-op
 * one from `installGasFakes`): while a lock is held, the simulated second
 * execution is deferred instead of running, which is what `waitLock` does in
 * production. If the operation under test is not locked, the intruder runs
 * mid-operation and corrupts the sheet — that is the regression being pinned.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { createMigrationRunner } from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { NoMigrationsToRollbackError } from '../../src/core/migration'
import { DuplicateIdError } from '../../src/core/errors'
import { FakeSheet } from '../../src/testing/fake-sheet'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { installGasFakes } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'
import type { DataStore, Row, RowWithId } from '../../src/core/types'

const SPREADSHEET_ID = 'test-spreadsheet-id'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name', 'age']

interface TestRow extends RowWithId {
  id: string | number
  name: string
  age: number
}

const BASE_OPTIONS: SheetsAdapterOptions = {
  spreadsheetId: SPREADSHEET_ID,
  sheetName: SHEET_NAME,
  columns: COLUMNS
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Shared state of the exclusive script-lock fake. */
interface LockState {
  held: boolean
  acquisitions: number
}

/**
 * Installs a `LockService` whose script lock is genuinely exclusive: a second
 * `waitLock()` while the lock is held throws, so any test that accidentally
 * re-acquires (rather than deferring) fails loudly instead of silently passing.
 */
function installExclusiveLock(): LockState {
  const state: LockState = { held: false, acquisitions: 0 }
  const lock = {
    waitLock(): void {
      if (state.held) {
        throw new Error('waitLock: script lock is already held by another execution')
      }
      state.held = true
      state.acquisitions++
    },
    tryLock(): boolean {
      if (state.held) return false
      state.held = true
      state.acquisitions++
      return true
    },
    releaseLock(): void {
      state.held = false
    },
    hasLock(): boolean {
      return state.held
    }
  }
  ;(globalThis as Record<string, unknown>).LockService = { getScriptLock: () => lock }
  return state
}

/**
 * A simulated second GAS execution. `run()` executes it immediately when the
 * script lock is free, and defers it until `drain()` when the lock is held —
 * mirroring an execution parked in `waitLock`.
 */
function concurrentExecution(lockState: LockState, work: () => void) {
  const deferred: (() => void)[] = []
  return {
    run(): void {
      if (lockState.held) {
        deferred.push(work)
      } else {
        work()
      }
    },
    drain(): void {
      while (deferred.length > 0) {
        deferred.shift()!()
      }
    },
    get wasDeferred(): boolean {
      return deferred.length > 0
    }
  }
}

/**
 * Fires `run` once, right after the first ID-column scan reads its values —
 * i.e. between "find the row index" and "write to that row index".
 */
function interruptAfterIdScan(sheet: FakeSheet, run: () => void): void {
  let armed = true
  const original = sheet.getRange.bind(sheet)
  vi.spyOn(sheet, 'getRange').mockImplementation(
    (row: number, col: number, numRows = 1, numCols = 1) => {
      const range = original(row, col, numRows, numCols)
      if (armed && row === 2 && numCols === 1) {
        armed = false
        const getValues = range.getValues.bind(range)
        range.getValues = () => {
          const values = getValues()
          run()
          return values
        }
      }
      return range
    }
  )
}

/**
 * Fires `run` once, right after the first full-width data-block read returns —
 * i.e. between batchUpdate's "read every row" and its ranged writes, where a
 * concurrent deleteRow shifts every computed row index up by one.
 */
function interruptAfterDataScan(sheet: FakeSheet, run: () => void): void {
  let armed = true
  const original = sheet.getRange.bind(sheet)
  vi.spyOn(sheet, 'getRange').mockImplementation(
    (row: number, col: number, numRows = 1, numCols = 1) => {
      const range = original(row, col, numRows, numCols)
      if (armed && row === 2 && col === 1 && numCols === COLUMNS.length) {
        armed = false
        const getValues = range.getValues.bind(range)
        range.getValues = () => {
          const values = getValues()
          run()
          return values
        }
      }
      return range
    }
  )
}

/** Fires `run` once, right after the first `getLastRow()` reads its value. */
function interruptAfterLastRow(sheet: FakeSheet, run: () => void): void {
  let armed = true
  const original = sheet.getLastRow.bind(sheet)
  vi.spyOn(sheet, 'getLastRow').mockImplementation(() => {
    const lastRow = original()
    if (armed) {
      armed = false
      run()
    }
    return lastRow
  })
}

/** Registers one shared FakeSheet as the fake spreadsheet and returns it. */
function setupSharedSheet(rows: unknown[][]): FakeSheet {
  const spreadsheet: FakeSpreadsheet = fromArrays({ [SHEET_NAME]: rows })
  installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
  return spreadsheet.getSheetByName(SHEET_NAME)!
}

/** Raw grid rows below the header, as written on the sheet. */
function dataRows(sheet: FakeSheet): unknown[][] {
  const lastRow = sheet.getLastRow()
  if (lastRow <= 1) return []
  return sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues()
}

function idsOnSheet(sheet: FakeSheet): unknown[] {
  return dataRows(sheet).map(row => row[0])
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
  delete (globalThis as Record<string, unknown>).LockService
})

// ---------------------------------------------------------------------------
// Interleaved concurrency
// ---------------------------------------------------------------------------

describe('SheetsAdapter concurrency (#128)', () => {
  describe('update()', () => {
    it('does not write to a stale row index when another execution deletes a row above', () => {
      const sheet = setupSharedSheet([
        ['id', 'name', 'age'],
        [1, 'Alice', 30],
        [2, 'Bob', 25],
        [3, 'Carol', 35]
      ])
      const lockState = installExclusiveLock()

      const writer = new SheetsAdapter<TestRow>(BASE_OPTIONS)
      const deleter = new SheetsAdapter<TestRow>(BASE_OPTIONS)

      const other = concurrentExecution(lockState, () => {
        deleter.delete(1)
      })
      interruptAfterIdScan(sheet, () => other.run())

      writer.update(3, { name: 'Carol Updated' })
      other.drain()

      // Exactly two rows survive: id 2 untouched, id 3 updated in place.
      expect(idsOnSheet(sheet)).toEqual([2, 3])
      expect(dataRows(sheet)[1]).toEqual([3, 'Carol Updated', 35])
    })
  })

  describe('delete()', () => {
    it('does not delete the wrong row when another execution deletes a row above', () => {
      const sheet = setupSharedSheet([
        ['id', 'name', 'age'],
        [1, 'Alice', 30],
        [2, 'Bob', 25],
        [3, 'Carol', 35],
        [4, 'Dave', 40]
      ])
      const lockState = installExclusiveLock()

      const first = new SheetsAdapter<TestRow>(BASE_OPTIONS)
      const second = new SheetsAdapter<TestRow>(BASE_OPTIONS)

      const other = concurrentExecution(lockState, () => {
        second.delete(1)
      })
      interruptAfterIdScan(sheet, () => other.run())

      first.delete(3)
      other.drain()

      // Ids 1 and 3 were the deletion targets, so 2 and 4 must remain.
      expect(idsOnSheet(sheet)).toEqual([2, 4])
    })
  })

  describe('batchInsert() in client mode', () => {
    it('does not overwrite rows written by a concurrent client-mode batch insert', () => {
      const sheet = setupSharedSheet([['id', 'name', 'age']])
      const lockState = installExclusiveLock()

      const first = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })
      const second = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

      const other = concurrentExecution(lockState, () => {
        second.batchInsert([
          { id: 'c', name: 'Carol', age: 35 },
          { id: 'd', name: 'Dave', age: 40 }
        ])
      })
      interruptAfterLastRow(sheet, () => other.run())

      first.batchInsert([
        { id: 'a', name: 'Alice', age: 30 },
        { id: 'b', name: 'Bob', age: 25 }
      ])
      other.drain()

      expect(idsOnSheet(sheet).sort()).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  describe('batchUpdate()', () => {
    it('does not overwrite an unrelated row when another execution deletes a row above (#155)', () => {
      const sheet = setupSharedSheet([
        ['id', 'name', 'age'],
        [1, 'Alice', 30],
        [2, 'Bob', 25],
        [3, 'Carol', 35],
        [4, 'Dave', 40]
      ])
      const lockState = installExclusiveLock()

      const writer = new SheetsAdapter<TestRow>(BASE_OPTIONS)
      const deleter = new SheetsAdapter<TestRow>(BASE_OPTIONS)

      const other = concurrentExecution(lockState, () => {
        deleter.delete(1)
      })
      // The delete lands between the data-block read and writeRowRuns, so an
      // unlocked batchUpdate writes Carol's values into row 4 — which by then
      // holds Dave.
      interruptAfterDataScan(sheet, () => other.run())

      const results = writer.batchUpdate([{ id: 3, data: { name: 'Carol Updated' } }])
      other.drain()

      expect(results).toEqual([{ id: 3, name: 'Carol Updated', age: 35 }])
      expect(idsOnSheet(sheet)).toEqual([2, 3, 4])
      expect(dataRows(sheet)).toEqual([
        [2, 'Bob', 25],
        [3, 'Carol Updated', 35],
        [4, 'Dave', 40]
      ])
    })
  })

  describe('insert() in client mode', () => {
    it('rejects an id a concurrent execution inserted first', () => {
      const sheet = setupSharedSheet([['id', 'name', 'age']])
      const lockState = installExclusiveLock()

      const first = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })
      const second = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

      second.insert({ id: 'dup', name: 'Winner', age: 1 })

      expect(() => first.insert({ id: 'dup', name: 'Loser', age: 2 })).toThrow(DuplicateIdError)
      expect(idsOnSheet(sheet)).toEqual(['dup'])
      expect(lockState.acquisitions).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Lock coverage: acquire before the read, release after the write
// ---------------------------------------------------------------------------

describe('SheetsAdapter lock coverage (#128)', () => {
  function setupCapturedLock(sheet: FakeSheet) {
    const spreadsheet = new FakeSpreadsheet('TestSpreadsheet', [sheet])
    installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })

    const lockService = (globalThis as Record<string, unknown>).LockService as {
      getScriptLock: () => { waitLock: (ms: number) => void; releaseLock: () => void }
    }
    const lock = lockService.getScriptLock()
    vi.spyOn(lock, 'waitLock')
    vi.spyOn(lock, 'releaseLock')
    vi.spyOn(lockService, 'getScriptLock').mockReturnValue(lock)
    return lock as unknown as {
      waitLock: ReturnType<typeof vi.fn>
      releaseLock: ReturnType<typeof vi.fn>
    }
  }

  function order(spy: { mock: { invocationCallOrder: number[] } }): number {
    return spy.mock.invocationCallOrder[0]
  }

  /**
   * Invocation order of the first `getRange` that touches DATA (row >= 2).
   *
   * Row 1 is read by the header-drift guard (#179), a pre-flight check that
   * deliberately runs before the lock is taken: it protects against a human
   * column insert, which no execution-level lock can serialize, so a drifted
   * sheet should fail without first queueing behind the lock. The critical
   * section under test is the row scan and the write, both of which read data
   * rows.
   */
  function orderOfFirstDataRead(spy: {
    mock: { calls: unknown[][]; invocationCallOrder: number[] }
  }): number {
    const index = spy.mock.calls.findIndex(([row]) => row !== 1)
    return spy.mock.invocationCallOrder[index]
  }

  /**
   * Spies `getRange` and every `setValues` it hands out, so writes can be
   * ordered against lock acquisition/release.
   */
  function captureWrites(sheet: FakeSheet) {
    const writes: ReturnType<typeof vi.fn>[] = []
    const original = sheet.getRange.bind(sheet)
    const getRange = vi
      .spyOn(sheet, 'getRange')
      .mockImplementation((row: number, col: number, numRows = 1, numCols = 1) => {
        const range = original(row, col, numRows, numCols)
        const write = vi.fn(range.setValues.bind(range))
        range.setValues = write
        writes.push(write)
        return range
      })

    return {
      getRange,
      lastWrite: () => writes.filter(write => write.mock.calls.length > 0).pop()
    }
  }

  it('update() holds the lock across the row scan and the write', () => {
    const sheet = fromArrays({
      [SHEET_NAME]: [
        ['id', 'name', 'age'],
        [1, 'Alice', 30]
      ]
    }).getSheetByName(SHEET_NAME)!
    const lock = setupCapturedLock(sheet)
    const { getRange, lastWrite } = captureWrites(sheet)

    new SheetsAdapter<TestRow>(BASE_OPTIONS).update(1, { name: 'Updated' })

    const write = lastWrite()
    expect(write).toBeDefined()
    expect(order(lock.waitLock)).toBeLessThan(orderOfFirstDataRead(getRange))
    expect(order(lock.releaseLock)).toBeGreaterThan(order(write!))
  })

  it('delete() holds the lock across the row scan and deleteRow', () => {
    const sheet = fromArrays({
      [SHEET_NAME]: [
        ['id', 'name', 'age'],
        [1, 'Alice', 30]
      ]
    }).getSheetByName(SHEET_NAME)!
    const lock = setupCapturedLock(sheet)
    vi.spyOn(sheet, 'deleteRow')

    new SheetsAdapter<TestRow>(BASE_OPTIONS).delete(1)

    const deleteRow = sheet.deleteRow as unknown as { mock: { invocationCallOrder: number[] } }
    expect(order(lock.waitLock)).toBeLessThan(order(deleteRow))
    expect(order(lock.releaseLock)).toBeGreaterThan(order(deleteRow))
  })

  it('client-mode insert() holds the lock across the uniqueness check and appendRow', () => {
    const sheet = fromArrays({ [SHEET_NAME]: [['id', 'name', 'age']] }).getSheetByName(SHEET_NAME)!
    const lock = setupCapturedLock(sheet)
    vi.spyOn(sheet, 'appendRow')

    new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })
      .insert({ id: 'a', name: 'Alice', age: 30 })

    const appendRow = sheet.appendRow as unknown as { mock: { invocationCallOrder: number[] } }
    expect(order(lock.waitLock)).toBeLessThan(order(appendRow))
    expect(order(lock.releaseLock)).toBeGreaterThan(order(appendRow))
  })

  it('client-mode batchInsert() holds the lock across the batch write', () => {
    const sheet = fromArrays({ [SHEET_NAME]: [['id', 'name', 'age']] }).getSheetByName(SHEET_NAME)!
    const lock = setupCapturedLock(sheet)
    const { lastWrite } = captureWrites(sheet)

    new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' }).batchInsert([
      { id: 'a', name: 'Alice', age: 30 },
      { id: 'b', name: 'Bob', age: 25 }
    ])

    const write = lastWrite()
    expect(write).toBeDefined()
    expect(order(lock.waitLock)).toBeLessThan(order(write!))
    expect(order(lock.releaseLock)).toBeGreaterThan(order(write!))
  })

  it('batchUpdate() holds the lock across the data read and the write (#155)', () => {
    const sheet = fromArrays({
      [SHEET_NAME]: [
        ['id', 'name', 'age'],
        [1, 'Alice', 30]
      ]
    }).getSheetByName(SHEET_NAME)!
    const lock = setupCapturedLock(sheet)
    const { getRange, lastWrite } = captureWrites(sheet)

    new SheetsAdapter<TestRow>(BASE_OPTIONS).batchUpdate([{ id: 1, data: { name: 'Updated' } }])

    const write = lastWrite()
    expect(write).toBeDefined()
    expect(order(lock.waitLock)).toBeLessThan(orderOfFirstDataRead(getRange))
    expect(order(lock.releaseLock)).toBeGreaterThan(order(write!))
  })

  it('keeps working when LockService is unavailable (Node)', () => {
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      [1, 'Alice', 30]
    ])
    delete (globalThis as Record<string, unknown>).LockService

    const adapter = new SheetsAdapter<TestRow>(BASE_OPTIONS)
    expect(adapter.update(1, { name: 'Updated' })?.name).toBe('Updated')
    expect(adapter.batchUpdate([{ id: 1, data: { name: 'Batched' } }])).toEqual([
      { id: 1, name: 'Batched', age: 30 }
    ])
    expect(adapter.delete(1)).toBe(true)

    const clientAdapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })
    expect(clientAdapter.insert({ id: 'x', name: 'X', age: 1 }).id).toBe('x')
    expect(clientAdapter.batchInsert([{ id: 'y', name: 'Y', age: 2 }])).toHaveLength(1)
    expect(idsOnSheet(sheet)).toEqual(['x', 'y'])
  })
})

// ---------------------------------------------------------------------------
// Client-mode ID uniqueness
// ---------------------------------------------------------------------------

describe('SheetsAdapter client-mode ID uniqueness (#128)', () => {
  it('insert() throws DuplicateIdError for an id already on the sheet', () => {
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      ['a', 'Alice', 30]
    ])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    expect(() => adapter.insert({ id: 'a', name: 'Clone', age: 1 })).toThrow(DuplicateIdError)
    expect(idsOnSheet(sheet)).toEqual(['a'])
  })

  it('matches ids across string/number representations', () => {
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      [7, 'Alice', 30]
    ])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    expect(() => adapter.insert({ id: '7', name: 'Clone', age: 1 })).toThrow(DuplicateIdError)
    expect(idsOnSheet(sheet)).toEqual([7])
  })

  it('carries the offending id and a stable error code', () => {
    setupSharedSheet([
      ['id', 'name', 'age'],
      ['a', 'Alice', 30]
    ])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    try {
      adapter.insert({ id: 'a', name: 'Clone', age: 1 })
      expect.unreachable('insert should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateIdError)
      expect((error as DuplicateIdError).id).toBe('a')
      expect((error as DuplicateIdError).code).toBe('DUPLICATE_ID')
    }
  })

  it('batchInsert() throws before writing anything when an id already exists', () => {
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      ['a', 'Alice', 30]
    ])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    expect(() =>
      adapter.batchInsert([
        { id: 'b', name: 'Bob', age: 25 },
        { id: 'a', name: 'Clone', age: 1 }
      ])
    ).toThrow(DuplicateIdError)
    expect(idsOnSheet(sheet)).toEqual(['a'])
  })

  it('batchInsert() rejects ids duplicated within the same batch', () => {
    const sheet = setupSharedSheet([['id', 'name', 'age']])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    expect(() =>
      adapter.batchInsert([
        { id: 'a', name: 'Alice', age: 30 },
        { id: 'a', name: 'Clone', age: 1 }
      ])
    ).toThrow(DuplicateIdError)
    expect(idsOnSheet(sheet)).toEqual([])
  })

  it('still accepts distinct ids', () => {
    const sheet = setupSharedSheet([['id', 'name', 'age']])
    const adapter = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, idMode: 'client' })

    adapter.insert({ id: 'a', name: 'Alice', age: 30 })
    adapter.batchInsert([
      { id: 'b', name: 'Bob', age: 25 },
      { id: 'c', name: 'Carol', age: 35 }
    ])

    expect(idsOnSheet(sheet)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// MigrationRunner locking
// ---------------------------------------------------------------------------

describe('MigrationRunner locking (#128)', () => {
  function migrationsStore(): MockAdapter<MigrationRecord> {
    return new MockAdapter<MigrationRecord>()
  }

  function runnerWith(
    store: DataStore<MigrationRecord>,
    migrations: Migration[],
    resolver: StoreResolver = <T extends Row>() =>
      new MockAdapter<T & RowWithId>() as unknown as DataStore<T>
  ) {
    return createMigrationRunner({ migrationsStore: store, storeResolver: resolver, migrations })
  }

  /** Installs a lock whose acquisition runs `onAcquire` (a concurrent execution finishing). */
  function installLockWithSideEffect(onAcquire: () => void) {
    const lock = {
      waitLock: vi.fn(onAcquire),
      tryLock: vi.fn(() => true),
      releaseLock: vi.fn(),
      hasLock: vi.fn(() => true)
    }
    ;(globalThis as Record<string, unknown>).LockService = { getScriptLock: () => lock }
    return lock
  }

  it('migrate() re-reads pending migrations after acquiring the lock', async () => {
    const store = migrationsStore()
    const up = vi.fn()
    const migrations: Migration[] = [
      { version: 1, name: 'first', up, down: vi.fn() }
    ]
    const runner = runnerWith(store, migrations)

    // Another execution applied version 1 while this one waited for the lock.
    installLockWithSideEffect(() => {
      store.insert({ version: 1, name: 'first', appliedAt: new Date().toISOString() })
    })

    const result = await runner.migrate()

    expect(up).not.toHaveBeenCalled()
    expect(result.applied).toEqual([])
    expect(store.findAll()).toHaveLength(1)
  })

  it('migrate() holds the lock across the whole run', async () => {
    const store = migrationsStore()
    const insertSpy = vi.spyOn(store, 'insert')
    const lock = installLockWithSideEffect(() => {})
    const runner = runnerWith(store, [
      { version: 1, name: 'first', up: vi.fn(), down: vi.fn() }
    ])

    await runner.migrate()

    expect(lock.waitLock).toHaveBeenCalled()
    expect(lock.releaseLock).toHaveBeenCalled()
    const acquire = lock.waitLock.mock.invocationCallOrder[0]
    const write = insertSpy.mock.invocationCallOrder[0]
    const release = lock.releaseLock.mock.invocationCallOrder[0]
    expect(acquire).toBeLessThan(write)
    expect(release).toBeGreaterThan(write)
  })

  it('rollback() re-reads applied migrations after acquiring the lock', async () => {
    const store = migrationsStore()
    store.insert({ version: 1, name: 'first', appliedAt: new Date().toISOString() })
    const down = vi.fn()
    const runner = runnerWith(store, [{ version: 1, name: 'first', up: vi.fn(), down }])

    // Another execution rolled the same migration back while this one waited.
    installLockWithSideEffect(() => {
      for (const record of store.findAll()) store.delete(record.id)
    })

    await expect(runner.rollback()).rejects.toBeInstanceOf(NoMigrationsToRollbackError)
    expect(down).not.toHaveBeenCalled()
  })

  it('does not deadlock when a migration writes through a locking adapter', async () => {
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      [1, 'Alice', '']
    ])
    // Exclusive lock: a second, non-reentrant acquisition would throw.
    installExclusiveLock()

    const users = new SheetsAdapter<TestRow>(BASE_OPTIONS)
    const resolver: StoreResolver = <T extends Row>() => users as unknown as DataStore<T>
    const runner = runnerWith(
      migrationsStore(),
      [
        {
          version: 1,
          name: 'default-age',
          up: schema => schema.addColumn(SHEET_NAME, 'age', { default: 99 }),
          down: schema => schema.removeColumn(SHEET_NAME, 'age')
        }
      ],
      resolver
    )

    await expect(runner.migrate()).resolves.toMatchObject({ currentVersion: 1 })
    users.clearCache()
    expect(dataRows(sheet)[0]).toEqual([1, 'Alice', 99])
  })

  it('does not deadlock when a migration renames or removes a column physically (#180)', async () => {
    // Both physical schema ops take the script lock themselves, so they must
    // re-enter the one migrate() already holds instead of asking for a second.
    const sheet = setupSharedSheet([
      ['id', 'name', 'age'],
      [1, 'Alice', 30]
    ])
    installExclusiveLock()

    // Post-migration schema: `name` renamed to `label`, `age` dropped.
    const users = new SheetsAdapter<TestRow>({ ...BASE_OPTIONS, columns: ['id', 'label'] })
    const resolver: StoreResolver = <T extends Row>() => users as unknown as DataStore<T>
    const runner = runnerWith(
      migrationsStore(),
      [
        {
          version: 1,
          name: 'rename-and-drop',
          up: schema => {
            schema.renameColumn(SHEET_NAME, 'name', 'label')
            schema.removeColumn(SHEET_NAME, 'age')
          },
          down: schema => schema.renameColumn(SHEET_NAME, 'label', 'name')
        }
      ],
      resolver
    )

    await expect(runner.migrate()).resolves.toMatchObject({ currentVersion: 1 })
    expect(sheet.getRange(1, 1, 2, 2).getValues()).toEqual([
      ['id', 'label'],
      [1, 'Alice']
    ])
  })

  it('migrate() still runs when LockService is unavailable (Node)', async () => {
    delete (globalThis as Record<string, unknown>).LockService
    const store = migrationsStore()
    const runner = runnerWith(store, [
      { version: 1, name: 'first', up: vi.fn(), down: vi.fn() }
    ])

    const result = await runner.migrate()
    expect(result.currentVersion).toBe(1)
  })
})
