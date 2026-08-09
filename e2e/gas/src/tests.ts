/**
 * Golden E2E tests for @gsquery/core against a REAL Google Spreadsheet.
 *
 * These exercise the exact behaviors that unit tests can only verify against
 * fakes — most importantly the assumptions about how real Sheets parses
 * USER_ENTERED writes (formula-injection escaping, #130) and physical column
 * insertion (migration addColumn, #127).
 *
 * Every test creates its own uniquely named sheet inside the configured test
 * spreadsheet and the harness deletes all `e2e_<runId>_*` sheets afterwards
 * (when the runtime supports sheet deletion — the Node fakes do not).
 */
import { SheetsAdapter } from '@gsquery/core'
import type { ColumnType } from '@gsquery/core'
import { assertEq, assertOk, assertThrows, test } from './runner'

export interface HarnessContext {
  spreadsheetId: string
  runId: string
}

interface E2ERow {
  id: string | number
  name?: string
  note?: string
  labels?: string[]
  active?: boolean
  meta?: Record<string, unknown>
  when?: Date | string
  status?: string
  [key: string]: unknown
}

export function registerTests(ctx: HarnessContext): void {
  const createdSheets: string[] = []

  const sheetName = (slug: string): string => {
    const name = `e2e_${ctx.runId}_${slug}`
    createdSheets.push(name)
    return name
  }

  const makeAdapter = (
    slug: string,
    columns: string[],
    opts: { idMode?: 'auto' | 'client'; columnTypes?: Record<string, ColumnType>; allowFormulas?: boolean } = {}
  ): SheetsAdapter<E2ERow> =>
    new SheetsAdapter<E2ERow>({
      spreadsheetId: ctx.spreadsheetId,
      sheetName: sheetName(slug),
      columns,
      idMode: opts.idMode ?? 'auto',
      columnTypes: opts.columnTypes,
      allowFormulas: opts.allowFormulas
    })

  // ── 1. Formula-injection escaping: the #130 USER_ENTERED assumption ──────
  test('formula escape: dangerous strings round-trip as literals, never as formulas', () => {
    const adapter = makeAdapter('escape', ['id', 'note'], { idMode: 'client' })
    const dangerous = ['=1+1', '=IMPORTXML("http://example.invalid/","//x")', '+2+2', '-3-3', '@sum', "'already quoted"]

    dangerous.forEach((note, i) => adapter.insert({ id: `r${i}`, note }))

    const rows = adapter.findAll()
    assertEq(rows.length, dangerous.length, 'all rows inserted')
    dangerous.forEach((note, i) => {
      const row = rows.find(r => r.id === `r${i}`)
      assertOk(row, `row r${i} present`)
      assertEq(row?.note, note, `value for ${JSON.stringify(note)} survives the round trip unchanged`)
    })

    // Real-GAS-only raw check: the cell must not have become a live formula.
    const ss = SpreadsheetApp.openById(ctx.spreadsheetId)
    const sheet = ss.getSheetByName(`e2e_${ctx.runId}_escape`)
    if (sheet) {
      const range = sheet.getRange(2, 2)
      if (typeof (range as { getFormula?: () => string }).getFormula === 'function') {
        assertEq(range.getFormula(), '', 'cell holds literal text, not a formula')
        const display = range.getValue()
        assertOk(display !== 2, 'the "=1+1" cell did not evaluate to 2')
      }
    }
  })

  // ── 2. Date round-trip through columnTypes ────────────────────────────────
  test('date columnType: Date survives write + read with identical timestamp', () => {
    const adapter = makeAdapter('dates', ['id', 'when'], { columnTypes: { when: 'date' } })
    const when = new Date('2026-03-01T10:20:30.000Z')
    const created = adapter.insert({ when })

    const found = adapter.findById(created.id)
    assertOk(found, 'row found')
    assertOk(found?.when instanceof Date, `deserialized as Date (got ${typeof found?.when})`)
    assertEq((found?.when as Date).getTime(), when.getTime(), 'timestamp identical')
  })

  // ── 3. Auto-id CRUD ───────────────────────────────────────────────────────
  test('auto-id CRUD: create, findById, update, delete', () => {
    const adapter = makeAdapter('crud', ['id', 'name'])
    const a = adapter.insert({ name: 'alpha' })
    const b = adapter.insert({ name: 'beta' })
    assertOk(a.id !== b.id, 'auto ids are distinct')

    adapter.update(b.id, { name: 'beta2' })
    assertEq(adapter.findById(b.id)?.name, 'beta2', 'update landed on the right row')
    assertEq(adapter.findById(a.id)?.name, 'alpha', 'other row untouched')

    assertOk(adapter.delete(a.id), 'delete reports success')
    assertEq(adapter.findById(a.id), undefined, 'deleted row gone')
    assertEq(adapter.findAll().length, 1, 'one row remains')
  })

  // ── 4. Client-mode duplicate ID rejection (#128) ─────────────────────────
  test('client idMode: duplicate ID insert throws DuplicateIdError', () => {
    const adapter = makeAdapter('dup', ['id', 'name'], { idMode: 'client' })
    adapter.insert({ id: 'u-1', name: 'first' })
    assertThrows(() => adapter.insert({ id: 'u-1', name: 'second' }), 'DUPLICATE_ID', 'second insert of u-1')
    assertEq(adapter.findAll().length, 1, 'no duplicate row was written')
  })

  // ── 5. batchInsert ────────────────────────────────────────────────────────
  test('batchInsert: 50 rows land with sequential auto ids', () => {
    const adapter = makeAdapter('binsert', ['id', 'name'])
    const rows = adapter.batchInsert(Array.from({ length: 50 }, (_, i) => ({ name: `n${i}` })))
    assertEq(rows.length, 50, 'returned 50 rows')

    const all = adapter.findAll()
    assertEq(all.length, 50, 'sheet holds 50 rows')
    const ids = all.map(r => Number(r.id)).sort((x, y) => x - y)
    assertEq(ids[49] - ids[0], 49, 'ids are a contiguous run')
  })

  // ── 6. batchUpdate correctness (contiguous + scattered, #129) ────────────
  test('batchUpdate: contiguous and scattered updates land on the right rows', () => {
    const adapter = makeAdapter('bupdate', ['id', 'name'])
    const rows = adapter.batchInsert(Array.from({ length: 20 }, (_, i) => ({ name: `orig${i}` })))

    const targets = [0, 1, 2, 3, 9, 15, 16, 19] // one run + scattered singles + tail run
    adapter.batchUpdate(targets.map(i => ({ id: rows[i].id, data: { name: `upd${i}` } })))

    const all = adapter.findAll()
    for (let i = 0; i < 20; i++) {
      const row = all.find(r => r.id === rows[i].id)
      const expected = targets.indexOf(i) !== -1 ? `upd${i}` : `orig${i}`
      assertEq(row?.name, expected, `row ${i}`)
    }
  })

  // ── 7. Typed columns round-trip ───────────────────────────────────────────
  test('columnTypes: string[], boolean, json round-trip', () => {
    const adapter = makeAdapter('typed', ['id', 'labels', 'active', 'meta'], {
      columnTypes: { labels: 'string[]', active: 'boolean', meta: 'json' }
    })
    const created = adapter.insert({ labels: ['a', 'b'], active: false, meta: { k: 1, nested: { ok: true } } })

    const row = adapter.findById(created.id)
    assertEq(row?.labels, ['a', 'b'], 'string[]')
    assertEq(row?.active, false, 'boolean false survives (not empty/"FALSE" string)')
    assertEq(row?.meta, { k: 1, nested: { ok: true } }, 'json object')
  })

  // ── 8. addColumn: physical header + single-pass backfill (#127) ──────────
  // Exercises SheetsAdapter.addColumn directly (synchronous) rather than
  // through MigrationRunner.migrate(): the web-app request path must stay
  // fully synchronous (see runner.ts), and the runner's async orchestration
  // is covered by the unit suite and the local fake check. What only real
  // GAS can prove — the physical column insert, ranged backfill, and
  // convergence — lives in the adapter method tested here.
  test('addColumn: header physically extended, defaults backfilled, converges on rerun', () => {
    const slug = 'mig'
    const name = sheetName(slug)
    // Seed with the OLD schema (no `status` column yet).
    const seed = new SheetsAdapter<E2ERow>({ spreadsheetId: ctx.spreadsheetId, sheetName: name, columns: ['id', 'name'] })
    seed.insert({ name: 'row1' })
    seed.insert({ name: 'row2' })

    // New-schema adapter declares `status`; the physical sheet is behind.
    const store = new SheetsAdapter<E2ERow>({
      spreadsheetId: ctx.spreadsheetId,
      sheetName: name,
      columns: ['id', 'name', 'status']
    })
    store.addColumn('status', { default: 'unknown' })

    const rows = store.findAll()
    assertEq(rows.length, 2, 'both rows present after addColumn')
    assertOk(rows.every(r => r.status === 'unknown'), 'default backfilled into every row')

    // The physical header row must actually contain the new column — this is
    // what separates the real #127 fix (header insert + backfill) from the
    // old value-backfill that left the sheet header untouched.
    const ss = SpreadsheetApp.openById(ctx.spreadsheetId)
    const sheet = ss.getSheetByName(name)
    assertOk(sheet, 'migrated sheet exists')
    const grid = (): string => JSON.stringify(sheet?.getRange(1, 1, 3, 3).getValues())
    const header = sheet ? (sheet.getRange(1, 1, 1, 3).getValues()[0] as string[]) : []
    assertEq(header, ['id', 'name', 'status'], 'physical header row extended')

    // Convergence: a second addColumn must not touch the grid at all.
    const before = grid()
    store.addColumn('status', { default: 'unknown' })
    assertEq(grid(), before, 'rerun leaves the grid byte-identical')
  })

  // ── 9. addColumn for an undeclared column fails loudly (#127) ────────────
  test('addColumn: undeclared column throws UnknownColumnError, sheet untouched', () => {
    const store = makeAdapter('migbad', ['id', 'name'])
    store.insert({ name: 'x' })

    assertThrows(() => store.addColumn('ghost', { default: 'boo' }), 'UNKNOWN_COLUMN', 'addColumn(ghost)')

    const rows = store.findAll()
    assertEq(rows.length, 1, 'row count unchanged')
    assertEq(rows[0]?.name, 'x', 'row content unchanged')
  })

  // ── 10. Stale-index guard: delete above, then update below (#128) ────────
  test('update after a deletion above still lands on the right record', () => {
    const adapter = makeAdapter('shift', ['id', 'name'])
    const r1 = adapter.insert({ name: 'one' })
    const r2 = adapter.insert({ name: 'two' })
    const r3 = adapter.insert({ name: 'three' })

    adapter.delete(r2.id)
    adapter.update(r3.id, { name: 'three-updated' })

    assertEq(adapter.findById(r3.id)?.name, 'three-updated', 'row 3 updated')
    assertEq(adapter.findById(r1.id)?.name, 'one', 'row 1 untouched')
    assertEq(adapter.findAll().length, 2, 'exactly two rows remain')
  })

  // ── 11. Timing probe (informational — never fails) ───────────────────────
  test('timing: batchInsert 100 + findAll (reported in ms via test duration)', () => {
    const adapter = makeAdapter('timing', ['id', 'name'])
    adapter.batchInsert(Array.from({ length: 100 }, (_, i) => ({ name: `t${i}` })))
    adapter.clearCache()
    const all = adapter.findAll()
    assertEq(all.length, 100, '100 rows read back')
  })

  // Expose for cleanup by the harness entrypoint.
  registerTests.createdSheets = createdSheets
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace registerTests {
  let createdSheets: string[]
}
