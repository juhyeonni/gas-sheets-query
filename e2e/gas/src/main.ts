/**
 * GAS entrypoints for the E2E harness.
 *
 * Deployed as a web app (`clasp push` + one-time deploy), then driven by CI:
 *   GET ?action=run                        → run the golden suite, JSON result
 *   GET ?action=burst&tag=a&n=25           → insert n auto-id rows (call twice in parallel)
 *   GET ?action=burstCheck&expect=50       → verify unique ids and row count after a burst pair
 *   GET ?action=mixedBurst&tag=a&seed=1    → mixed insert/update/delete/batchUpdate workload
 *   GET ?action=mixedCheck&tags=left,right → verify the mixed workload's invariants
 *   GET ?action=cleanup                    → delete all e2e_* sheets
 *
 * If a Script Property `E2E_TOKEN` is set, every request must carry the same
 * value as `?token=`. The spreadsheet is resolved from the Script Property
 * `GSQUERY_E2E_SPREADSHEET_ID`, falling back to the checked-in default.
 */
import { SheetsAdapter } from '@gsquery/core'
import { clearTests, runSuite } from './runner'
import { registerTests } from './tests'
import type { SuiteResult } from './runner'

/** Dedicated test spreadsheet (owned by the repo owner's account). */
const DEFAULT_SPREADSHEET_ID = '1q7ohGZIKdier53G87UqeS34tL1p5ldfw8-7pW8PZnLM'

const BURST_SHEET = 'e2e_burst'

interface BurstRow {
  id: string | number
  tag?: string
  [key: string]: unknown
}

function getSpreadsheetId(): string {
  if (typeof PropertiesService !== 'undefined') {
    const configured = PropertiesService.getScriptProperties().getProperty('GSQUERY_E2E_SPREADSHEET_ID')
    if (configured) return configured
  }
  return DEFAULT_SPREADSHEET_ID
}

function newRunId(): string {
  return new Date().getTime().toString(36)
}

export function runAll(spreadsheetId?: string, runId?: string): SuiteResult & { runId: string } {
  const id = spreadsheetId ?? getSpreadsheetId()
  const rid = runId ?? newRunId()

  clearTests()
  registerTests({ spreadsheetId: id, runId: rid })
  const suite = runSuite()

  cleanupRunSheets(id, rid)
  return { ...suite, runId: rid }
}

/** Deletes this run's sheets when the runtime supports it (real GAS does; fakes don't). */
function cleanupRunSheets(spreadsheetId: string, runId: string): void {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId) as unknown as {
      getSheets?: () => { getName: () => string }[]
      deleteSheet?: (sheet: unknown) => void
    }
    if (typeof ss.getSheets !== 'function' || typeof ss.deleteSheet !== 'function') return
    for (const sheet of ss.getSheets()) {
      if (sheet.getName().indexOf(`e2e_${runId}_`) === 0) {
        ss.deleteSheet(sheet)
      }
    }
    purgeMetaRows(ss, `e2e_${runId}_`)
  } catch {
    // Cleanup is best-effort; leftover sheets are removed by ?action=cleanup.
  }
}

function deleteAllE2ESheets(spreadsheetId: string): number {
  const ss = SpreadsheetApp.openById(spreadsheetId) as unknown as {
    getSheets?: () => { getName: () => string }[]
    deleteSheet?: (sheet: unknown) => void
    insertSheet?: (name: string) => unknown
  }
  if (typeof ss.getSheets !== 'function' || typeof ss.deleteSheet !== 'function') return 0
  let deleted = 0
  const sheets = ss.getSheets()
  // A spreadsheet must keep at least one sheet; park one if everything is e2e_*.
  if (sheets.every(s => s.getName().indexOf('e2e_') === 0) && typeof ss.insertSheet === 'function') {
    try {
      ss.insertSheet('keep')
    } catch {
      // already exists — fine
    }
  }
  for (const sheet of ss.getSheets()) {
    if (sheet.getName().indexOf('e2e_') === 0) {
      ss.deleteSheet(sheet)
      deleted++
    }
  }
  purgeMetaRows(ss, 'e2e_')
  return deleted
}

/**
 * Drops `_gsquery_meta` id-counter rows (#177) belonging to deleted e2e
 * tables, so the shared test spreadsheet's meta sheet doesn't accumulate a
 * row per run forever. Best-effort and bottom-up (deleteRow shifts rows up).
 */
function purgeMetaRows(ss: unknown, prefix: string): void {
  try {
    const container = ss as {
      getSheetByName?: (name: string) => {
        getLastRow: () => number
        getRange: (r: number, c: number, nr: number, nc: number) => { getValues: () => unknown[][] }
        deleteRow: (r: number) => void
      } | null
    }
    if (typeof container.getSheetByName !== 'function') return
    const meta = container.getSheetByName('_gsquery_meta')
    if (!meta) return
    const lastRow = meta.getLastRow()
    if (lastRow < 2) return
    const tables = meta.getRange(2, 1, lastRow - 1, 1).getValues()
    for (let i = tables.length - 1; i >= 0; i--) {
      if (String(tables[i][0]).indexOf(prefix) === 0) {
        meta.deleteRow(i + 2)
      }
    }
  } catch {
    // Leftover counter rows are harmless; never fail a run over cleanup.
  }
}

/**
 * Insert `n` auto-id rows tagged `tag`. CI fires two of these in parallel to
 * exercise the real LockService: with correct locking the two bursts must not
 * collide on ids or overwrite each other's rows.
 */
export function burst(tag: string, n: number): { inserted: number; tag: string; errors: string[] } {
  const adapter = new SheetsAdapter<BurstRow>({
    spreadsheetId: getSpreadsheetId(),
    sheetName: BURST_SHEET,
    columns: ['id', 'tag']
  })
  // Per-insert error capture so a failed burst is distinguishable from a
  // silently lost row (#164): `inserted` is the count the server actually
  // claims, and burstCheck's expectation should match the sum of the two
  // bursts' `inserted` values.
  const errors: string[] = []
  let inserted = 0
  for (let i = 0; i < n; i++) {
    try {
      adapter.insert({ tag: `${tag}-${i}` })
      inserted++
    } catch (err) {
      errors.push(`${tag}-${i}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
    }
  }
  return { inserted, tag, errors }
}

export function burstCheck(expect: number): {
  ok: boolean
  rowCount: number
  uniqueIds: number
  uniqueTags: number
  expected: number
} {
  const adapter = new SheetsAdapter<BurstRow>({
    spreadsheetId: getSpreadsheetId(),
    sheetName: BURST_SHEET,
    columns: ['id', 'tag']
  })
  adapter.clearCache()
  const rows = adapter.findAll()
  const ids = new Set(rows.map(r => String(r.id)))
  const tags = new Set(rows.map(r => String(r.tag)))
  return {
    ok: rows.length === expect && ids.size === expect && tags.size === expect,
    rowCount: rows.length,
    uniqueIds: ids.size,
    uniqueTags: tags.size,
    expected: expect
  }
}

// ── Mixed concurrent workload (S1) ──────────────────────────────────────────
//
// `burst` proves one thing: parallel *inserts* don't collide on ids. Production
// traffic is not one operation type — it is inserts, updates, deletes and batch
// writes arriving at the same sheet at the same time, and the dangerous races
// live in the read-then-write ops (a concurrent deleteRow shifts every row
// number the other caller just resolved, #128/#155).
//
// Invariant design: each caller only ever touches ROWS IT INSERTED ITSELF, and
// its operations are chosen so the per-tag end state is a pure function of the
// tag — no matter how the two callers interleave. That is what makes the check
// order-independent, which is the only kind of assertion that is meaningful
// under real concurrency.

const MIXED_SHEET = 'e2e_mixed'
const MIXED_COLUMNS = ['id', 'tag', 'slot', 'state', 'key']

/** Slots each caller inserts. Slot is caller-local, so the two tags never overlap. */
const MIXED_INSERT_COUNT = 10
/** Slots re-written with `update()` — after the inserts. */
const MIXED_UPDATE_SLOTS = [0, 1, 2, 3, 4]
/** Slots removed with `delete()` — disjoint from every slot written afterwards. */
const MIXED_DELETE_SLOTS = [7, 8, 9]
/** Slots re-written with a single `batchUpdate()` — the last write to touch them. */
const MIXED_BATCH_SLOTS = [2, 3, 4, 5, 6]

const MIXED_EXPECTED_SURVIVORS = MIXED_INSERT_COUNT - MIXED_DELETE_SLOTS.length

interface MixedRow {
  id: string | number
  tag?: unknown
  slot?: unknown
  state?: unknown
  key?: unknown
  [column: string]: unknown
}

/**
 * The end state of one slot, independent of interleaving.
 *
 * Deletes are disjoint from the later writes, and batchUpdate always runs last,
 * so the final state of a slot depends only on which sets it belongs to.
 * `undefined` means the row must not exist any more.
 */
function expectedMixedState(slot: number): string | undefined {
  if (MIXED_DELETE_SLOTS.indexOf(slot) !== -1) return undefined
  if (MIXED_BATCH_SLOTS.indexOf(slot) !== -1) return 'b'
  if (MIXED_UPDATE_SLOTS.indexOf(slot) !== -1) return 'u'
  return 'i'
}

/**
 * Deterministic Fisher-Yates shuffle (LCG) — `seed` varies the ORDER in which a
 * caller issues its operations without changing the end state, so two runs of
 * the same workload explore different interleavings against the other caller.
 */
function shuffled(items: number[], seed: number): number[] {
  const out = items.slice()
  let state = (seed >>> 0) || 1
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const j = state % (i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

export interface MixedBurstResult {
  tag: string
  seed: number
  inserted: number
  updated: number
  deleted: number
  batchUpdated: number
  errors: string[]
}

/**
 * Run one caller's share of the mixed workload against the shared sheet.
 *
 * CI fires two of these in parallel with different tags and seeds; the end
 * state each one is responsible for is fixed, so `mixedCheck` can assert it
 * exactly without knowing anything about how the two runs interleaved.
 */
export function mixedBurst(tag: string, seed: number, spreadsheetId?: string): MixedBurstResult {
  const adapter = new SheetsAdapter<MixedRow>({
    spreadsheetId: spreadsheetId ?? getSpreadsheetId(),
    sheetName: MIXED_SHEET,
    columns: MIXED_COLUMNS
  })

  const errors: string[] = []
  const idBySlot: Record<number, string | number> = {}
  const allSlots = Array.from({ length: MIXED_INSERT_COUNT }, (_, i) => i)

  let inserted = 0
  for (const slot of shuffled(allSlots, seed)) {
    try {
      const row = adapter.insert({ tag, slot, state: 'i', key: `${tag}:${slot}` })
      idBySlot[slot] = row.id
      inserted++
    } catch (err) {
      errors.push(`insert ${tag}:${slot}: ${describeError(err)}`)
    }
  }

  let updated = 0
  for (const slot of shuffled(MIXED_UPDATE_SLOTS, seed + 1)) {
    const id = idBySlot[slot]
    if (id === undefined) continue
    try {
      adapter.update(id, { state: 'u' })
      updated++
    } catch (err) {
      errors.push(`update ${tag}:${slot}: ${describeError(err)}`)
    }
  }

  let deleted = 0
  for (const slot of shuffled(MIXED_DELETE_SLOTS, seed + 2)) {
    const id = idBySlot[slot]
    if (id === undefined) continue
    try {
      if (adapter.delete(id)) deleted++
      else errors.push(`delete ${tag}:${slot}: row not found`)
    } catch (err) {
      errors.push(`delete ${tag}:${slot}: ${describeError(err)}`)
    }
  }

  let batchUpdated = 0
  const batchItems = MIXED_BATCH_SLOTS
    .filter(slot => idBySlot[slot] !== undefined)
    .map(slot => ({ id: idBySlot[slot], data: { state: 'b' } }))
  try {
    batchUpdated = adapter.batchUpdate(batchItems).length
  } catch (err) {
    errors.push(`batchUpdate ${tag}: ${describeError(err)}`)
  }

  return { tag, seed, inserted, updated, deleted, batchUpdated, errors }
}

export interface MixedTagReport {
  tag: string
  survivors: number
  expectedSurvivors: number
  missingSlots: number[]
  unexpectedSlots: number[]
  wrongStates: string[]
}

export interface MixedCheckResult {
  ok: boolean
  rowCount: number
  expectedRowCount: number
  tags: MixedTagReport[]
  duplicateIds: string[]
  duplicateKeys: string[]
  /** Rows whose fields do not all belong to the same caller — the corruption signature. */
  contaminated: string[]
  unknownTags: string[]
}

/**
 * Verify the mixed workload WITHOUT assuming any interleaving.
 *
 * A row is self-consistent only when its `key` — written once, at insert time,
 * as `<tag>:<slot>` — still reconstructs from its own `tag` and `slot` cells.
 * A row that mixes two callers' values (a partial overwrite, a write that
 * landed on a shifted row number) fails that reconstruction, which is what
 * "cross-tag contamination" means here.
 */
export function mixedCheck(tags: string[], spreadsheetId?: string): MixedCheckResult {
  const adapter = new SheetsAdapter<MixedRow>({
    spreadsheetId: spreadsheetId ?? getSpreadsheetId(),
    sheetName: MIXED_SHEET,
    columns: MIXED_COLUMNS
  })
  adapter.clearCache()
  const rows = adapter.findAll()

  const seenIds: Record<string, number> = {}
  const seenKeys: Record<string, number> = {}
  const duplicateIds: string[] = []
  const duplicateKeys: string[] = []
  const contaminated: string[] = []
  const unknownTags: string[] = []
  const stateByTagSlot: Record<string, string> = {}

  for (const row of rows) {
    const id = String(row.id)
    seenIds[id] = (seenIds[id] ?? 0) + 1
    if (seenIds[id] === 2) duplicateIds.push(id)

    const rowTag = String(row.tag ?? '')
    const rowSlot = String(row.slot ?? '')
    const rowKey = String(row.key ?? '')

    seenKeys[rowKey] = (seenKeys[rowKey] ?? 0) + 1
    if (seenKeys[rowKey] === 2) duplicateKeys.push(rowKey)

    // Self-consistency: tag + slot must rebuild the key written at insert time.
    if (rowKey !== `${rowTag}:${rowSlot}`) {
      contaminated.push(`id=${id} tag=${rowTag} slot=${rowSlot} key=${rowKey} state=${String(row.state ?? '')}`)
      continue
    }
    if (tags.indexOf(rowTag) === -1) {
      unknownTags.push(`id=${id} tag=${rowTag}`)
      continue
    }
    stateByTagSlot[`${rowTag}:${rowSlot}`] = String(row.state ?? '')
  }

  const tagReports: MixedTagReport[] = tags.map(tag => {
    const missingSlots: number[] = []
    const unexpectedSlots: number[] = []
    const wrongStates: string[] = []
    let survivors = 0

    for (let slot = 0; slot < MIXED_INSERT_COUNT; slot++) {
      const actual = stateByTagSlot[`${tag}:${slot}`]
      const expected = expectedMixedState(slot)
      if (actual === undefined) {
        if (expected !== undefined) missingSlots.push(slot)
        continue
      }
      survivors++
      if (expected === undefined) unexpectedSlots.push(slot)
      else if (actual !== expected) wrongStates.push(`${tag}:${slot} expected=${expected} actual=${actual}`)
    }

    return {
      tag,
      survivors,
      expectedSurvivors: MIXED_EXPECTED_SURVIVORS,
      missingSlots,
      unexpectedSlots,
      wrongStates
    }
  })

  const expectedRowCount = MIXED_EXPECTED_SURVIVORS * tags.length
  const ok =
    rows.length === expectedRowCount &&
    duplicateIds.length === 0 &&
    duplicateKeys.length === 0 &&
    contaminated.length === 0 &&
    unknownTags.length === 0 &&
    tagReports.every(
      report =>
        report.survivors === report.expectedSurvivors &&
        report.missingSlots.length === 0 &&
        report.unexpectedSlots.length === 0 &&
        report.wrongStates.length === 0
    )

  return {
    ok,
    rowCount: rows.length,
    expectedRowCount,
    tags: tagReports,
    duplicateIds,
    duplicateKeys,
    contaminated,
    unknownTags
  }
}

/** Parse `?tags=left,right` into a clean list, falling back to the CI defaults. */
function parseTags(param: string | undefined): string[] {
  const parsed = (param ?? '').split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
  return parsed.length > 0 ? parsed : ['left', 'right']
}

/** Parse a numeric query parameter, falling back when it is absent or unparseable. */
function parseNumber(param: string | undefined, fallback: number): number {
  const parsed = Number(param)
  return isNaN(parsed) ? fallback : parsed
}

function checkToken(param: string | undefined): boolean {
  if (typeof PropertiesService === 'undefined') return true
  const required = PropertiesService.getScriptProperties().getProperty('E2E_TOKEN')
  if (!required) return true
  return param === required
}

interface DoGetEvent {
  parameter?: Record<string, string>
}

/**
 * Web-app entrypoint. Always returns JSON.
 *
 * MUST stay synchronous end to end: the web-app dispatcher does NOT await a
 * Promise returned from doGet — it fails with "returned value is not a
 * supported return type" (verified against the real platform; editor runs
 * DO await async entrypoints, which is why runAllTests worked while the
 * async doGet did not).
 */
export function doGet(e: DoGetEvent): GoogleAppsScript.Content.TextOutput {
  const params = e?.parameter ?? {}
  const respond = (body: unknown): GoogleAppsScript.Content.TextOutput =>
    ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)

  if (!checkToken(params.token)) {
    return respond({ error: 'invalid token' })
  }

  try {
    switch (params.action) {
      case 'run':
        return respond(runAll())
      case 'burst':
        return respond(burst(params.tag ?? 'a', Number(params.n ?? '25')))
      case 'burstCheck':
        return respond(burstCheck(Number(params.expect ?? '50')))
      case 'mixedBurst':
        return respond(mixedBurst(params.tag ?? 'a', parseNumber(params.seed, 1)))
      case 'mixedCheck':
        return respond(mixedCheck(parseTags(params.tags)))
      case 'cleanup':
        return respond({ deleted: deleteAllE2ESheets(getSpreadsheetId()) })
      default:
        return respond({ error: `unknown action: ${params.action ?? '(none)'}` })
    }
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return respond({ error })
  }
}

/** Editor-friendly entrypoint: run everything and log the JSON result. */
export function runAllTests(): SuiteResult & { runId: string } {
  const result = runAll()
  Logger.log(JSON.stringify(result, null, 2))
  return result
}
