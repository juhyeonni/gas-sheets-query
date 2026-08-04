/**
 * The same migration must produce the same result on MockAdapter and on
 * SheetsAdapter (#112).
 *
 * The schema operations live in the shared MigrationRunner, not in the
 * adapters, and their guards used to test for `undefined`. A Sheets cell
 * cannot hold `undefined` — SheetsAdapter writes it as `''` and reads it back
 * as `''` — so those guards held in memory and silently no-op'd against a real
 * sheet. These tests run one sequence through both stores and assert they agree.
 */
import { describe, it, expect } from 'vitest'
import { createMigrationRunner } from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { DataStore, Row } from '../../src/core/types'

const SPREADSHEET_ID = 'test-spreadsheet-id'

/** addColumn(status, default) → removeColumn(status) → addColumn(status, default) */
const RE_ADD_DEFAULT: Migration[] = [
  {
    version: 1,
    name: 'add-status',
    up: schema => schema.addColumn('users', 'status', { default: 'unknown' }),
    down: schema => schema.removeColumn('users', 'status'),
  },
]

const RENAME: Migration[] = [
  {
    version: 1,
    name: 'rename-name',
    up: schema => schema.renameColumn('users', 'name', 'label'),
    down: schema => schema.renameColumn('users', 'label', 'name'),
  },
]

function mockSetup() {
  const users = new MockAdapter<any>({ initialData: [{ id: 1, name: 'John' }] })
  const resolver: StoreResolver = <T extends Row>() => users as unknown as DataStore<T>
  return { users, resolver, read: () => users.findById(1) as Record<string, unknown> }
}

function sheetsSetup(columns: string[], header: unknown[][]) {
  const ss = fromArrays({ Users: header })
  installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: ss }, activeId: SPREADSHEET_ID })
  const users = new SheetsAdapter<any>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Users',
    columns,
  })
  const resolver: StoreResolver = <T extends Row>() => users as unknown as DataStore<T>
  return {
    users,
    resolver,
    read: () => {
      users.clearCache()
      return users.findById(1) as Record<string, unknown>
    },
  }
}

function runner(resolver: StoreResolver, migrations: Migration[]) {
  return createMigrationRunner({
    migrationsStore: new MockAdapter<MigrationRecord>(),
    storeResolver: resolver,
    migrations,
  })
}

describe('migration parity between MockAdapter and SheetsAdapter [#112]', () => {
  it('re-applies an addColumn default after removeColumn cleared it', async () => {
    const mock = mockSetup()
    const mockRunner = runner(mock.resolver, RE_ADD_DEFAULT)
    await mockRunner.migrate()
    await mockRunner.rollback()
    await mockRunner.migrate()

    const sheets = sheetsSetup(
      ['id', 'name', 'status'],
      [
        ['id', 'name', 'status'],
        [1, 'John', ''],
      ]
    )
    const sheetsRunner = runner(sheets.resolver, RE_ADD_DEFAULT)
    await sheetsRunner.migrate()
    await sheetsRunner.rollback()
    await sheetsRunner.migrate()

    expect(mock.read().status).toBe('unknown')
    expect(sheets.read().status).toBe('unknown')
  })

  it('applies renameColumn on both stores', async () => {
    const mock = mockSetup()
    await runner(mock.resolver, RENAME).migrate()

    const sheets = sheetsSetup(
      ['id', 'name', 'label'],
      [
        ['id', 'name', 'label'],
        [1, 'John', ''],
      ]
    )
    await runner(sheets.resolver, RENAME).migrate()

    expect(mock.read().label).toBe('John')
    expect(sheets.read().label).toBe('John')
    expect(sheets.users.getRawData()).toEqual([
      ['id', 'name', 'label'],
      [1, '', 'John'],
    ])
  })
})
