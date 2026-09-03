/**
 * #217 — public `upsert`: insert-or-update by id in one call.
 *
 * The sync contract already assumed upsert semantics (`insert` on the wire is
 * "create or replace", see sync-transport), but no public API expressed it.
 *
 * Three properties are pinned here beyond the happy path:
 *
 * - The existence check is the *write result*, not a prior read, so there is no
 *   window between deciding the branch and writing.
 * - The whole find-then-write sequence is held under ONE script lock, so two
 *   concurrent executions cannot both miss and both insert.
 * - A store that allocates its own ids refuses an unknown explicit id rather
 *   than writing the row under a different one.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { Repository } from '../../src/core/repository'
import { defineSheetsDB } from '../../src/core/sheets-db'
import { installGasFakes } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'
import { ValidationError } from '../../src/core/errors'
import type { DataStore, RowWithId } from '../../src/core/types'

interface User extends RowWithId {
  id: string | number
  name: string
  age: number
}

const SPREADSHEET_ID = 'test-spreadsheet-id'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name', 'age']

describe('Repository.upsert (#217)', () => {
  it('updates the existing row when the id is present', () => {
    const store = new MockAdapter<User>({
      idMode: 'client',
      initialData: [{ id: 'u1', name: 'Alice', age: 30 }]
    })
    const repo = new Repository(store, 'users')

    const result = repo.upsert({ id: 'u1', name: 'Alice B', age: 31 })

    expect(result).toEqual({ id: 'u1', name: 'Alice B', age: 31 })
    expect(store.findAll()).toHaveLength(1)
  })

  it('inserts when the id is not present, keeping the client id', () => {
    const store = new MockAdapter<User>({ idMode: 'client' })
    const repo = new Repository(store, 'users')

    const result = repo.upsert({ id: 'u9', name: 'New', age: 20 })

    expect(result).toEqual({ id: 'u9', name: 'New', age: 20 })
    expect(store.findById('u9')).toEqual(result)
  })

  it('inserts with a server-allocated id when no id is given (auto mode)', () => {
    const store = new MockAdapter<User>()
    const repo = new Repository(store, 'users')

    const result = repo.upsert({ name: 'New', age: 20 })

    expect(result.id).toBe(1)
    expect(store.findAll()).toHaveLength(1)
  })

  it('applies a partial patch to the existing row instead of replacing it', () => {
    const store = new MockAdapter<User>({
      idMode: 'client',
      initialData: [{ id: 'u1', name: 'Alice', age: 30 }]
    })
    const repo = new Repository(store, 'users')

    const result = repo.upsert({ id: 'u1', age: 31 })

    expect(result).toEqual({ id: 'u1', name: 'Alice', age: 31 })
  })

  it('refuses to invent a row when an auto-mode store is given an unknown id', () => {
    // Auto idMode owns id allocation, so the insert branch cannot honor the
    // requested id. Writing the row under a different one would leave every
    // reference to id 99 dangling with no error, so it fails instead.
    const store = new MockAdapter<User>({ initialData: [{ id: 1, name: 'Alice', age: 30 }] })
    const repo = new Repository(store, 'users')

    expect(() => repo.upsert({ id: 99, name: 'Ghost', age: 1 })).toThrow(ValidationError)
    expect(store.findAll()).toHaveLength(1)
  })

  it('creates in an auto-mode store when no id is supplied', () => {
    const store = new MockAdapter<User>({ initialData: [{ id: 1, name: 'Alice', age: 30 }] })

    const result = new Repository(store, 'users').upsert({ name: 'Bob', age: 25 })

    expect(result.id).toBe(2)
    expect(store.findAll()).toHaveLength(2)
  })

  it('still inserts under an unknown id when the store cannot report its idMode', () => {
    // A custom DataStore that does not declare idMode keeps the plain
    // "update, else insert" behavior — the guard only fires on a known 'auto'.
    const inner = new MockAdapter<User>({ idMode: 'client' })
    const store: DataStore<User> = {
      findAll: () => inner.findAll(),
      find: (o) => inner.find(o),
      findById: (id) => inner.findById(id),
      insert: (row) => inner.insert(row),
      update: (id, patch) => inner.update(id, patch),
      delete: (id) => inner.delete(id)
    }

    const result = new Repository(store, 'users').upsert({ id: 'u1', name: 'New', age: 20 })

    expect(result).toEqual({ id: 'u1', name: 'New', age: 20 })
  })

  it('does not read through the store cache to decide the branch', () => {
    const store = new MockAdapter<User>({
      idMode: 'client',
      initialData: [{ id: 'u1', name: 'Alice', age: 30 }]
    })
    const findById = vi.spyOn(store, 'findById')
    const repo = new Repository(store, 'users')

    repo.upsert({ id: 'u1', age: 31 })

    expect(findById).not.toHaveBeenCalled()
  })
})

describe('TableHandle.upsert (#217)', () => {
  it('is exposed as a shorthand on the table handle', () => {
    const db = defineSheetsDB({
      tables: {
        users: {
          columns: ['id', 'name', 'age'] as const,
          types: { id: '', name: '', age: 0 }
        }
      },
      stores: { users: new MockAdapter({ idMode: 'client' }) }
    })

    const created = db.from('users').upsert({ id: 'u1', name: 'Alice', age: 30 })
    const updated = db.from('users').upsert({ id: 'u1', name: 'Alice B', age: 31 })

    expect(created.id).toBe('u1')
    expect(updated).toEqual({ id: 'u1', name: 'Alice B', age: 31 })
    expect(db.from('users').findAll()).toHaveLength(1)
  })
})

describe('SheetsAdapter upsert atomicity (#217)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).LockService
    delete (globalThis as Record<string, unknown>).SpreadsheetApp
  })

  /** LockService whose script lock is exclusive, counting acquisitions. */
  function installExclusiveLock(): { acquisitions: number; held: boolean } {
    const state = { held: false, acquisitions: 0 }
    const lock = {
      waitLock(): void {
        if (state.held) throw new Error('waitLock: script lock is already held')
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

  it('holds one lock across the find-then-write sequence', () => {
    const spreadsheet = fromArrays({ [SHEET_NAME]: [COLUMNS, ['u1', 'Alice', 30]] })
    installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
    const lockState = installExclusiveLock()

    const adapter = new SheetsAdapter<User>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS,
      idMode: 'client'
    })
    const repo = new Repository(adapter, 'users')

    repo.upsert({ id: 'u1', age: 31 })

    // One acquisition, not one per inner store call: withScriptLock is
    // re-entrant, so the adapter's own lock nests inside the repository's.
    expect(lockState.acquisitions).toBe(1)
    expect(lockState.held).toBe(false)
    expect(adapter.findById('u1')).toEqual({ id: 'u1', name: 'Alice', age: 31 })
  })

  it('creates the row on the sheet when the id is absent', () => {
    const spreadsheet = fromArrays({ [SHEET_NAME]: [COLUMNS, ['u1', 'Alice', 30]] })
    installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
    installExclusiveLock()

    const adapter = new SheetsAdapter<User>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS,
      idMode: 'client'
    })

    const result = new Repository(adapter, 'users').upsert({ id: 'u2', name: 'Bob', age: 25 })

    expect(result).toEqual({ id: 'u2', name: 'Bob', age: 25 })
    adapter.clearCache()
    expect(adapter.findAll()).toHaveLength(2)
  })
})
