/**
 * #136 — re-run-to-resume semantics for an interrupted migration.
 *
 * A migration is recorded right after its own operations, so an execution
 * killed between those two points (the 6-minute ceiling, a quota) leaves the
 * operations applied but the migration unrecorded. There is deliberately no
 * "started" marker: the documented recovery is to call `migrate()` again,
 * which re-applies the whole migration. That is only safe because every
 * SheetsAdapter schema operation is idempotent. This test guards that.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createMigrationRunner, MigrationExecutionError } from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'
import type { DataStore, Row } from '../../src/core/types'

const SPREADSHEET_ID = 'migration-resume'

/** The schema the code is deployed with: the post-migration layout. */
const COLUMNS = ['id', 'label', 'status', 'email']

const INITIAL_SHEET: unknown[][] = [
  ['id', 'name', 'legacy'],
  [1, 'John', 'x'],
  [2, 'Jane', 'y']
]

// The operation order follows SheetsAdapter's positional rules: every step
// leaves a header that is a prefix of the declared columns.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'rename-name',
    up: schema => schema.renameColumn('users', 'name', 'label'),
    down: schema => schema.renameColumn('users', 'label', 'name')
  },
  {
    version: 2,
    name: 'reshape-users',
    up: schema => {
      // A destructive, structural step first: the one whose repeat would do
      // the most damage if it were not idempotent.
      schema.removeColumn('users', 'legacy')
      schema.addColumn('users', 'status', { default: 'active' })
      schema.addColumn('users', 'email', { default: 'n/a' })
    },
    down: schema => {
      schema.removeColumn('users', 'email')
      schema.removeColumn('users', 'status')
      schema.addColumn('users', 'legacy')
    }
  }
]

/** Number of schema operations in v1, then in v2. */
const V1_OPS = 1
const V2_OPS = 3

/** Simulates the runtime killing the execution. */
const KILL_MESSAGE = 'Exceeded maximum execution time'

let handle: GasFakesHandle | undefined

afterEach(() => handle?.restore())

interface Setup {
  users: SheetsAdapter<Record<string, unknown> & { id: number }>
  migrationsStore: MockAdapter<MigrationRecord>
  resolver: StoreResolver
  /** How many times the resolver was asked for a store (once per operation). */
  operationsStarted: () => number
}

function setup(): Setup {
  const spreadsheet = fromArrays({ Users: INITIAL_SHEET.map(row => [...row]) })
  handle?.restore()
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })

  const users = new SheetsAdapter<Record<string, unknown> & { id: number }>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Users',
    columns: COLUMNS
  })
  let started = 0
  const resolver: StoreResolver = <T extends Row>() => {
    started++
    return users as unknown as DataStore<T>
  }
  return {
    users,
    migrationsStore: new MockAdapter<MigrationRecord>(),
    resolver,
    operationsStarted: () => started
  }
}

function runnerFor(s: Pick<Setup, 'migrationsStore'>, resolver: StoreResolver) {
  return createMigrationRunner({
    migrationsStore: s.migrationsStore,
    storeResolver: resolver,
    migrations: MIGRATIONS
  })
}

async function uninterruptedSheet(): Promise<unknown[][]> {
  const s = setup()
  await runnerFor(s, s.resolver).migrate()
  return s.users.getRawData()
}

describe('migrate() resumes an interrupted migration [#136]', () => {
  it('produces the expected end state when nothing interrupts it', async () => {
    expect(await uninterruptedSheet()).toEqual([
      ['id', 'label', 'status', 'email'],
      [1, 'John', 'active', 'n/a'],
      [2, 'Jane', 'active', 'n/a']
    ])
  })

  // Kill v2 after 0, 1 and 2 of its 3 operations have been applied.
  it.each([0, 1, 2])(
    'completes on the next migrate() after v2 stopped with %i of its operations applied',
    async appliedBeforeKill => {
      const expected = await uninterruptedSheet()
      const s = setup()

      const killAt = V1_OPS + appliedBeforeKill + 1
      const killingResolver: StoreResolver = <T extends Row>(table: string) => {
        if (s.operationsStarted() + 1 === killAt) {
          throw new Error(KILL_MESSAGE)
        }
        return s.resolver<T>(table)
      }

      const error = await runnerFor(s, killingResolver).migrate().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(MigrationExecutionError)
      expect((error as MigrationExecutionError).version).toBe(2)
      expect(s.migrationsStore.findAll().map(r => r.version)).toEqual([1])
      // The interruption really left the sheet half-migrated.
      s.users.clearCache()
      expect(s.users.getRawData()).not.toEqual(expected)

      // The next execution: a fresh runner over the same sheet and table.
      s.users.clearCache()
      const result = await runnerFor(s, s.resolver).migrate()

      expect(result.applied).toEqual([{ version: 2, name: 'reshape-users' }])
      s.users.clearCache()
      expect(s.users.getRawData()).toEqual(expected)
      expect(s.migrationsStore.findAll().map(r => r.version)).toEqual([1, 2])
    }
  )

  it('completes on the next migrate() after v2 applied every operation but was not recorded', async () => {
    const expected = await uninterruptedSheet()
    const s = setup()

    const insert = s.migrationsStore.insert.bind(s.migrationsStore)
    let killRecord = true
    s.migrationsStore.insert = (record) => {
      if (killRecord && record.version === 2) {
        killRecord = false
        throw new Error(KILL_MESSAGE)
      }
      return insert(record)
    }

    const error = await runnerFor(s, s.resolver).migrate().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MigrationExecutionError)
    expect(s.operationsStarted()).toBe(V1_OPS + V2_OPS)
    expect(s.migrationsStore.findAll().map(r => r.version)).toEqual([1])

    s.users.clearCache()
    await runnerFor(s, s.resolver).migrate()

    s.users.clearCache()
    expect(s.users.getRawData()).toEqual(expected)
    const records = s.migrationsStore.findAll()
    expect(records.map(r => r.version)).toEqual([1, 2])
    expect(records.filter(r => r.version === 2)).toHaveLength(1)
  })
})
