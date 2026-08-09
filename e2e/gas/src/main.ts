/**
 * GAS entrypoints for the E2E harness.
 *
 * Deployed as a web app (`clasp push` + one-time deploy), then driven by CI:
 *   GET ?action=run                        → run the golden suite, JSON result
 *   GET ?action=burst&tag=a&n=25           → insert n auto-id rows (call twice in parallel)
 *   GET ?action=burstCheck&expect=50       → verify unique ids and row count after a burst pair
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
  return deleted
}

/**
 * Insert `n` auto-id rows tagged `tag`. CI fires two of these in parallel to
 * exercise the real LockService: with correct locking the two bursts must not
 * collide on ids or overwrite each other's rows.
 */
export function burst(tag: string, n: number): { inserted: number; tag: string } {
  const adapter = new SheetsAdapter<BurstRow>({
    spreadsheetId: getSpreadsheetId(),
    sheetName: BURST_SHEET,
    columns: ['id', 'tag']
  })
  for (let i = 0; i < n; i++) {
    adapter.insert({ tag: `${tag}-${i}` })
  }
  return { inserted: n, tag }
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
