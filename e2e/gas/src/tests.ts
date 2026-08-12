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

/**
 * Structural views used to feature-detect real-GAS-only methods.
 *
 * The in-repo fakes implement an allowlisted subset of the Sheets surface and
 * deliberately omit what they cannot simulate faithfully (`Range.sort`,
 * `Sheet.insertRowBefore`). The human-interference probes below therefore test
 * for the method before using it and skip only that sub-assertion under fakes —
 * a missing fake method must never turn the local check red.
 */
interface SortableRange {
  sort?: (spec: { column: number; ascending: boolean }) => unknown
}
interface RowInsertingSheet {
  insertRowBefore?: (rowIndex: number) => unknown
}
interface ColumnInsertingSheet {
  insertColumnBefore?: (columnIndex: number) => unknown
}

/** A cell as read back, normalized to a string so number/string cell coercion differences don't matter. */
function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/** MigrationRunner's emptiness test, inlined (it is not exported from core). */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

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

  // ── 3b. Monotonic auto ids (#177) ─────────────────────────────────────────
  test('auto ids are never reused after deleting the max row (#177)', () => {
    const adapter = makeAdapter('noreuse', ['id', 'name'])
    adapter.insert({ name: 'a' })
    adapter.insert({ name: 'b' })
    const c = adapter.insert({ name: 'c' })

    adapter.delete(c.id)
    const d = adapter.insert({ name: 'd' })
    assertOk(Number(d.id) > Number(c.id), `id ${d.id} allocated after deleted max ${c.id} — no reuse`)

    // Delete everything: the persisted counter must outlive the data.
    for (const row of adapter.findAll()) adapter.delete(row.id)
    const e = adapter.insert({ name: 'e' })
    assertOk(Number(e.id) > Number(d.id), `id ${e.id} still moves forward on an emptied table`)
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

  // ── Shared helpers for the production scenarios (S2–S4) ──────────────────

  /** Open a sheet by name; throws (via the caller's assertOk) when absent. */
  const openSheet = (name: string): GoogleAppsScript.Spreadsheet.Sheet | null =>
    SpreadsheetApp.openById(ctx.spreadsheetId).getSheetByName(name)

  /**
   * Read a rectangle of the physical grid as strings.
   *
   * The assertions below are about *layout* — which value sits under which
   * header — so they must bypass the adapter's positional mapping entirely,
   * and must not care whether GAS hands back `1` or `'1'` for a numeric cell.
   */
  const rawCells = (
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    row: number,
    col: number,
    numRows: number,
    numCols: number
  ): string[][] => {
    const values = sheet.getRange(row, col, numRows, numCols).getValues() as unknown[][]
    return values.map(line => line.map(cellText))
  }

  const rawRow = (
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    row: number,
    numCols: number
  ): string[] => rawCells(sheet, row, 1, 1, numCols)[0]

  // ══ S2. Human interference ═══════════════════════════════════════════════
  // Production sheets are not owned by the script: people open them and sort,
  // insert rows, add their own columns. These three probes seed data through
  // the adapter and then edit the sheet the way a human would — directly via
  // SpreadsheetApp — to find out which edits the positional adapter survives.

  // ── 12. Human sorts the data range by a non-id column ────────────────────
  test('human edit: sorting the data range by a non-id column keeps update/findById on target', t => {
    const adapter = makeAdapter('humansort', ['id', 'name', 'score'])
    const rows = adapter.batchInsert(
      // Descending score, so an ascending sort by score reverses every row.
      Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, score: 50 - i * 10 }))
    )
    const sheet = openSheet(`e2e_${ctx.runId}_humansort`)
    assertOk(sheet, 'seeded sheet exists')
    if (!sheet) return

    const range = sheet.getRange(2, 1, rows.length, 3)
    const sortable = range as unknown as SortableRange
    if (typeof sortable.sort === 'function') {
      sortable.sort({ column: 3, ascending: true })
      const scores = rawCells(sheet, 2, 3, rows.length, 1).map(([value]) => Number(value))
      assertEq(scores, [0, 10, 20, 30, 40, 50], 'the human sort really did reorder the physical rows')
    } else {
      t.info('skipped Range.sort (not implemented by the fakes)')
    }

    // The adapter resolves rows by scanning the id column, so physical order
    // must be irrelevant to both reads and writes.
    adapter.clearCache()
    assertEq(adapter.findAll().length, 6, 'all rows still readable after the sort')
    assertEq(adapter.findById(rows[0].id)?.name, 'p0', 'findById still resolves the first-inserted row')
    assertEq(adapter.findById(rows[5].id)?.name, 'p5', 'findById still resolves the last-inserted row')

    adapter.update(rows[2].id, { name: 'p2-updated' })
    assertEq(adapter.findById(rows[2].id)?.name, 'p2-updated', 'update landed on the intended record')
    assertEq(adapter.findById(rows[1].id)?.name, 'p1', 'neighbour above untouched')
    assertEq(adapter.findById(rows[3].id)?.name, 'p3', 'neighbour below untouched')
    assertEq(adapter.findAll().length, 6, 'no row gained or lost')
  })

  // ── 13. Human inserts a blank row in the middle ──────────────────────────
  test('human edit: a blank row inserted mid-table is skipped by reads and does not corrupt neighbours', t => {
    const adapter = makeAdapter('humanrow', ['id', 'name'])
    const rows = adapter.batchInsert(Array.from({ length: 5 }, (_, i) => ({ name: `r${i}` })))
    const sheet = openSheet(`e2e_${ctx.runId}_humanrow`)
    assertOk(sheet, 'seeded sheet exists')
    if (!sheet) return

    const inserter = sheet as unknown as RowInsertingSheet
    let blankRowIndex = -1
    if (typeof inserter.insertRowBefore === 'function') {
      // Physical row 4 holds r2 (row 1 is the header) — the blank lands between
      // r1 and r2, i.e. in the middle of the record block.
      blankRowIndex = 4
      inserter.insertRowBefore(blankRowIndex)
      assertEq(rawRow(sheet, blankRowIndex, 2), ['', ''], 'the inserted row really is blank')
    } else {
      t.info('skipped Sheet.insertRowBefore (not implemented by the fakes)')
    }

    adapter.clearCache()
    const all = adapter.findAll()
    assertEq(all.length, 5, 'the all-empty row is filtered out of reads')
    assertOk(all.every(row => !isEmptyValue(row.id)), 'no phantom row with an empty id leaked into the result')

    // A write below the gap must still land on its own record.
    adapter.update(rows[3].id, { name: 'r3-updated' })
    assertEq(adapter.findById(rows[3].id)?.name, 'r3-updated', 'update below the blank row hit the right record')
    assertEq(adapter.findById(rows[2].id)?.name, 'r2', 'record above the write untouched')
    assertEq(adapter.findById(rows[4].id)?.name, 'r4', 'record below the write untouched')

    // ...and the human's blank row must survive the write untouched.
    if (blankRowIndex > 0) {
      assertEq(rawRow(sheet, blankRowIndex, 2), ['', ''], 'the blank row was not overwritten by the update')
      assertEq(adapter.findAll().length, 5, 'still five records, blank row still ignored')
    }
  })

  // ── 14. Human inserts a foreign column in the middle — must FAIL LOUDLY ───
  // This adapter is positional: `rowToObject` maps cell index i to
  // `columns[i]`, so a column inserted to the LEFT of an existing one shifts
  // every value one place right. It used to do that in silence (characterized
  // here, then confirmed live in run 31298563680: misread on every field right
  // of the insert, and an update that destroyed the human's column while
  // leaving the real trailing one stale). #179 added a header-drift guard: one
  // read of row 1 per execution, then SchemaMismatchError on divergence.
  //
  // The escape hatch `skipHeaderCheck: true` still buys the old behavior, and
  // this test pins that too — it is the documented-dangerous path, so it must
  // keep behaving exactly as characterized rather than half-failing.
  test('human edit: a foreign column inserted mid-table is rejected with SchemaMismatchError (#179)', t => {
    const adapter = makeAdapter('humancol', ['id', 'name', 'score'])
    const rows = adapter.batchInsert([
      { name: 'p0', score: 10 },
      { name: 'p1', score: 20 },
      { name: 'p2', score: 30 }
    ])
    const sheetNameForSlug = `e2e_${ctx.runId}_humancol`
    const sheet = openSheet(sheetNameForSlug)
    assertOk(sheet, 'seeded sheet exists')
    if (!sheet) return

    const inserter = sheet as unknown as ColumnInsertingSheet
    if (typeof inserter.insertColumnBefore !== 'function') {
      t.info('skipped Sheet.insertColumnBefore (not implemented by this runtime)')
      return
    }

    // The human adds their own "owner" column between `id` and `name`.
    inserter.insertColumnBefore(2)
    sheet.getRange(1, 2, 1, 1).setValues([['owner']])
    sheet.getRange(2, 2, 3, 1).setValues([['alice'], ['bob'], ['carol']])
    assertEq(rawRow(sheet, 1, 4), ['id', 'owner', 'name', 'score'], 'the sheet now has a column the schema knows nothing about')

    adapter.clearCache()

    // Read side: the misalignment is now an error, not a wrong answer.
    assertThrows(() => adapter.findAll(), 'SCHEMA_MISMATCH', 'findAll on a drifted sheet')
    assertThrows(() => adapter.findById(rows[0].id), 'SCHEMA_MISMATCH', 'findById on a drifted sheet')
    assertThrows(
      () => adapter.find({ where: [{ field: 'name', operator: '=', value: 'p0' }], orderBy: [] }),
      'SCHEMA_MISMATCH',
      'find on a drifted sheet'
    )

    // Write side: rejected before anything is written.
    assertThrows(() => adapter.update(rows[0].id, { name: 'renamed' }), 'SCHEMA_MISMATCH', 'update on a drifted sheet')
    assertThrows(() => adapter.insert({ name: 'p3', score: 40 }), 'SCHEMA_MISMATCH', 'insert on a drifted sheet')
    assertThrows(() => adapter.delete(rows[2].id), 'SCHEMA_MISMATCH', 'delete on a drifted sheet')

    // Nothing moved: the human's column and every data cell are exactly as they
    // were before the rejected operations.
    assertEq(rawRow(sheet, 1, 4), ['id', 'owner', 'name', 'score'], 'header untouched by the rejected writes')
    assertEq(
      rawCells(sheet, 2, 1, 3, 4),
      [
        [cellText(rows[0].id), 'alice', 'p0', '10'],
        [cellText(rows[1].id), 'bob', 'p1', '20'],
        [cellText(rows[2].id), 'carol', 'p2', '30']
      ],
      'no row was read wrong, written, or deleted — the guard fires before any mutation'
    )
    t.info('guarded: reads and writes throw SchemaMismatchError (SCHEMA_MISMATCH) naming the drifted column')

    // The escape hatch reproduces the old, dangerous behavior verbatim.
    const unguarded = new SheetsAdapter<E2ERow>({
      spreadsheetId: ctx.spreadsheetId,
      sheetName: sheetNameForSlug,
      columns: ['id', 'name', 'score'],
      skipHeaderCheck: true
    })
    const first = unguarded.findById(rows[0].id)
    assertOk(first, 'skipHeaderCheck: findById still resolves — the id column did not move')
    assertEq(cellText(first?.name), 'alice', "skipHeaderCheck: `name` reads the human's `owner` cell")
    assertEq(cellText(first?.score), 'p0', 'skipHeaderCheck: `score` reads the old `name` cell')

    const updated = unguarded.update(rows[0].id, { name: 'renamed' })
    assertOk(updated, 'skipHeaderCheck: update reports success')
    assertEq(
      rawRow(sheet, 2, 4),
      [cellText(rows[0].id), 'renamed', 'p0', '10'],
      "skipHeaderCheck: the write overwrote the human's `owner` cell; the real `score` column (4) is left stale"
    )
    assertEq(
      rawCells(sheet, 3, 2, 2, 1).map(([value]) => value),
      ['bob', 'carol'],
      'skipHeaderCheck: only the row that was written is damaged — untouched rows keep their owner value'
    )
    t.info('skipHeaderCheck: opts back into the documented-dangerous silent misalignment')
  })

  // ══ S3. Volume budget ════════════════════════════════════════════════════

  // ── 15. 2,000 rows: correctness plus loose ceilings ──────────────────────
  // One shared sheet for the whole scenario — re-seeding per assertion would
  // dominate the suite's wall clock. The bounds are ceilings, not targets: they
  // exist to catch an egregious blowup (a per-row write path sneaking back into
  // batchInsert), not to benchmark Google's backend.
  test('volume: 2,000-row table — batchInsert, findAll, filter, scattered batchUpdate, single update', t => {
    const ROW_COUNT = 2000
    const adapter = makeAdapter('vol', ['id', 'name', 'bucket', 'score'])

    const insertStart = Date.now()
    const inserted = adapter.batchInsert(
      Array.from({ length: ROW_COUNT }, (_, i) => ({ name: `v${i}`, bucket: `b${i % 10}`, score: i }))
    )
    const insertMs = Date.now() - insertStart
    assertEq(inserted.length, ROW_COUNT, 'batchInsert returned every row')
    const insertedIds = inserted.map(row => Number(row.id)).sort((a, b) => a - b)
    assertEq(
      insertedIds[ROW_COUNT - 1] - insertedIds[0],
      ROW_COUNT - 1,
      'ids are one contiguous run — a single locked allocation, not 2,000 of them'
    )

    adapter.clearCache()
    const findAllStart = Date.now()
    const all = adapter.findAll()
    const findAllMs = Date.now() - findAllStart
    assertEq(all.length, ROW_COUNT, 'findAll read every row back')

    const filterStart = Date.now()
    const filtered = adapter.find({ where: [{ field: 'bucket', operator: '=', value: 'b7' }], orderBy: [] })
    const filterMs = Date.now() - filterStart
    assertEq(filtered.length, ROW_COUNT / 10, 'filtered query returned exactly the matching decile')
    assertOk(filtered.every(row => row.bucket === 'b7'), 'no non-matching row leaked into the filtered result')

    // 200 deliberately non-adjacent rows: every run is length 1, which is the
    // worst case for writeRowRuns (one ranged write per dirty row).
    const targets = Array.from({ length: 200 }, (_, i) => i * 9 + 3)
    const batchStart = Date.now()
    adapter.batchUpdate(targets.map(i => ({ id: inserted[i].id, data: { name: `u${i}` } })))
    const batchMs = Date.now() - batchStart

    const lastIndex = ROW_COUNT - 1
    const updateStart = Date.now()
    adapter.update(inserted[lastIndex].id, { name: 'tail' })
    const updateMs = Date.now() - updateStart

    adapter.clearCache()
    const after = adapter.findAll()
    assertEq(after.length, ROW_COUNT, 'row count unchanged by the updates')
    const byId: Record<string, string> = {}
    for (const row of after) byId[String(row.id)] = cellText(row.name)

    for (const i of targets) {
      assertEq(byId[String(inserted[i].id)], `u${i}`, `scattered batchUpdate landed on row ${i}`)
    }
    assertEq(byId[String(inserted[lastIndex].id)], 'tail', 'single update landed on the tail row')

    const touched: Record<number, true> = {}
    for (const i of targets) touched[i] = true
    touched[lastIndex] = true
    for (let i = 0; i < ROW_COUNT; i += 37) {
      if (!touched[i]) assertEq(byId[String(inserted[i].id)], `v${i}`, `untouched row ${i} kept its value`)
    }

    t.info(
      `batchInsert(${ROW_COUNT})=${insertMs}ms findAll=${findAllMs}ms filter=${filterMs}ms ` +
      `batchUpdate(200 scattered)=${batchMs}ms update(1)=${updateMs}ms`
    )

    // Loose ceilings — only an egregious regression trips these.
    assertOk(insertMs < 60_000, `batchInsert(${ROW_COUNT}) took ${insertMs}ms (ceiling 60000ms)`)
    assertOk(findAllMs < 45_000, `findAll took ${findAllMs}ms (ceiling 45000ms)`)
    assertOk(filterMs < 45_000, `filtered query took ${filterMs}ms (ceiling 45000ms)`)
    assertOk(batchMs < 120_000, `batchUpdate(200 scattered) took ${batchMs}ms (ceiling 120000ms)`)
    assertOk(updateMs < 20_000, `single update took ${updateMs}ms (ceiling 20000ms)`)
  })

  // ══ S4. Live migration chain v1 → v3 ═════════════════════════════════════

  // ── 16. addColumn → renameColumn → removeColumn over live data ───────────
  // MigrationRunner.migrate() is async (withScriptLockAsync), and the web-app
  // request path must stay synchronous (see runner.ts), so this drives the
  // adapter operations a chain would issue, in the same order, asserting the
  // physical layout after every step.
  //
  // All three are PHYSICAL schema operations on the adapter (#127, #180): each
  // version's store declares the schema that version deploys, `addColumn`
  // extends the header, `renameColumn` rewrites the header cell, and
  // `removeColumn` deletes the column outright. Before #180 the last two were
  // value-only, which left a header reading `name` under a schema declaring
  // `displayName`, and a ghost `legacy` column that made the next deploy
  // misread and miswrite every column to its right.
  test('migration chain v1→v3 on live data: addColumn, renameColumn and removeColumn are all physical (#180)', t => {
    const name = sheetName('chain')
    // skipHeaderCheck (#179): from v2 on, this chain deliberately runs schemas
    // whose header the value-level rename/remove never updated — exactly the
    // drift the new guard rejects. Opting out here keeps the characterization
    // readable; the guard itself is covered by S2c. Once renameColumn is
    // physical (#180) the header stops drifting and this can come off.
    const makeStore = (columns: string[]): SheetsAdapter<E2ERow> =>
      new SheetsAdapter<E2ERow>({
        spreadsheetId: ctx.spreadsheetId,
        sheetName: name,
        columns,
        skipHeaderCheck: true
      })

    // v0 — the shape production is already running.
    const v0 = makeStore(['id', 'name', 'legacy'])
    const ann = v0.insert({ name: 'ann', legacy: 'L1' })
    const bob = v0.insert({ name: 'bob', legacy: 'L2' })

    const sheet = openSheet(name)
    assertOk(sheet, 'chain sheet exists')
    if (!sheet) return
    assertEq(rawRow(sheet, 1, 3), ['id', 'name', 'legacy'], 'v0 header')

    // ── v1: addColumn('status', default 'active') ────────────────────────────
    const v1 = makeStore(['id', 'name', 'legacy', 'status'])
    v1.addColumn('status', { default: 'active' })

    assertEq(rawRow(sheet, 1, 4), ['id', 'name', 'legacy', 'status'], 'v1: header physically extended')
    assertEq(rawRow(sheet, 2, 4), [cellText(ann.id), 'ann', 'L1', 'active'], 'v1: data still under its own headers')
    assertEq(rawRow(sheet, 3, 4), [cellText(bob.id), 'bob', 'L2', 'active'], 'v1: second row aligned too')
    assertEq(v1.findById(ann.id)?.status, 'active', 'v1: the backfilled default reads back')
    v1.update(bob.id, { status: 'archived' })
    assertEq(v1.findById(bob.id)?.status, 'archived', 'v1: writes to the new column land')
    assertEq(v1.findById(bob.id)?.name, 'bob', 'v1: the write did not disturb the other columns')

    // ── v2: renameColumn('name' → 'displayName') ────────────────────────────
    // The store declares the POST-rename schema, which is what the deploy
    // carrying this migration ships. The adapter rewrites the one header cell;
    // no data moves, because the value is already in the right column.
    const v2 = makeStore(['id', 'displayName', 'legacy', 'status'])
    v2.renameColumn('name', 'displayName')

    assertEq(
      rawRow(sheet, 1, 4),
      ['id', 'displayName', 'legacy', 'status'],
      'v2: the header cell was physically rewritten — header and schema agree again'
    )
    assertEq(rawRow(sheet, 2, 4), [cellText(ann.id), 'ann', 'L1', 'active'], 'v2: the rename moved no data')
    assertEq(rawRow(sheet, 3, 4), [cellText(bob.id), 'bob', 'L2', 'archived'], 'v2: second row untouched too')
    assertEq(v2.findById(ann.id)?.displayName, 'ann', 'v2: reads resolve under the new name')
    v2.update(ann.id, { displayName: 'ann2' })
    assertEq(
      rawRow(sheet, 2, 4),
      [cellText(ann.id), 'ann2', 'L1', 'active'],
      'v2: a write under the new name lands in its own column'
    )

    // Convergence: re-running the rename must not touch the grid at all.
    const wideGrid = (): string => JSON.stringify(sheet.getRange(1, 1, 3, 4).getValues())
    const beforeRenameRerun = wideGrid()
    v2.renameColumn('name', 'displayName')
    assertEq(wideGrid(), beforeRenameRerun, 'v2: rerun leaves the grid byte-identical')
    t.info('v2 rename: header cell rewritten in place, data untouched, rerun converges')

    // ── v3: removeColumn('legacy') ──────────────────────────────────────────
    // Again the store declares the POST-removal schema — the one the next
    // deploy runs with. Destructive by contract: the legacy values go with the
    // column and nothing can restore them.
    const v3 = makeStore(['id', 'displayName', 'status'])
    v3.removeColumn('legacy')

    assertEq(
      rawRow(sheet, 1, 3),
      ['id', 'displayName', 'status'],
      'v3: the column was physically deleted, not just blanked'
    )
    assertEq(rawRow(sheet, 2, 3), [cellText(ann.id), 'ann2', 'active'], 'v3: the columns right of the drop shifted with their data')
    assertEq(rawRow(sheet, 3, 3), [cellText(bob.id), 'bob', 'archived'], 'v3: second row aligned the same way')

    // The formerly dangerous part: a schema without `legacy` now reads and
    // writes the real columns instead of the abandoned one.
    v3.clearCache()
    const narrowed = v3.findById(ann.id)
    assertOk(narrowed, 'v3: the post-removal schema still finds the row')
    assertEq(cellText(narrowed?.displayName), 'ann2', 'v3: columns left of the drop still read correctly')
    assertEq(cellText(narrowed?.status), 'active', 'v3: `status` reads the real status, not the abandoned column')

    v3.update(ann.id, { status: 'live' })
    assertEq(
      rawRow(sheet, 2, 3),
      [cellText(ann.id), 'ann2', 'live'],
      'v3: the write lands in the real `status` column'
    )
    assertEq(v3.findAll().length, 2, 'v3: both records survived the column delete')

    // Convergence: the column is already gone, so a rerun is a no-op.
    const narrowGrid = (): string => JSON.stringify(sheet.getRange(1, 1, 3, 3).getValues())
    const beforeRemoveRerun = narrowGrid()
    v3.removeColumn('legacy')
    assertEq(narrowGrid(), beforeRemoveRerun, 'v3: rerun leaves the grid byte-identical')
    t.info('v3 remove: column physically deleted, remaining data stays aligned, rerun converges')
  })

  // Expose for cleanup by the harness entrypoint.
  registerTests.createdSheets = createdSheets
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace registerTests {
  let createdSheets: string[]
}
