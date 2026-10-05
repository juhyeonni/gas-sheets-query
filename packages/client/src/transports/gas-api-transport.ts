/**
 * GasApiTransport - SyncTransport implementation for Google Apps Script
 * Uses google.script.run in GAS environment, fetch in dev/browser environment.
 */
import type { RowWithId } from '@gsquery/core'
import type {
  SyncTransport,
  MergedMutation,
  SyncPushResult,
} from '../local/sync-transport.js'

/** A `google.script.run` runner once both handlers are attached */
type GasScriptRunner = Record<string, (...args: unknown[]) => void>

declare const google: {
  script: {
    run: {
      withSuccessHandler: <T>(callback: (result: T) => void) => {
        withFailureHandler: (callback: (error: Error) => void) => GasScriptRunner
      }
    }
  }
}

/** `Content-Type` the fetch path sends on push */
export type PushContentType = 'application/json' | 'text/plain'

/** Default fetch timeout: well below GAS's 6-minute execution limit */
const DEFAULT_TIMEOUT_MS = 60_000

/** Host of every deployed GAS web app (`https://script.google.com/macros/s/<id>/exec`) */
const GAS_WEB_APP_HOST = 'script.google.com'

/**
 * Query parameter the REST pull already uses for the table name. A context
 * entry with this key would collide with it, so the constructor rejects it.
 */
const RESERVED_CONTEXT_KEY = 'table'

export interface GasApiTransportOptions {
  /**
   * Base URL for the fetch path. If omitted, uses `google.script.run` inside
   * GAS and `/api` elsewhere. Pull GETs `<baseUrl>/sync/pull?table=<name>`,
   * push POSTs `{ table, mutations }` to `<baseUrl>/sync/push`. A deployed GAS
   * web app's `/exec` URL works: its `doGet`/`doPost` see `sync/pull` or
   * `sync/push` in `e.pathInfo`.
   */
  baseUrl?: string
  /** GAS function name for sync pull (default: 'syncPull') */
  pullFn?: string
  /** GAS function name for sync push (default: 'syncPush') */
  pushFn?: string
  /**
   * `Content-Type` of the push request on the fetch path. The body is JSON
   * either way.
   *
   * Default: `'text/plain'` when `baseUrl`'s host is `script.google.com`,
   * `'application/json'` otherwise. GAS web apps do not answer a CORS preflight,
   * and `text/plain` keeps the POST a "simple request" that needs none — so the
   * server must read the body as text and `JSON.parse` it
   * (`e.postData.contents`).
   */
  pushContentType?: PushContentType
  /**
   * Abort a fetch request that has not completed after this many ms
   * (default: 60000). `0` disables the timeout. Does not apply to
   * `google.script.run`, which cannot be cancelled.
   *
   * The transport never retries: a failed request rejects once, and the
   * `SyncEngine` retries with backoff.
   */
  timeoutMs?: number
  /**
   * Fixed routing metadata sent to the server on every pull and push, for
   * example `{ tenant: 'team-a' }` when one backend serves several
   * spreadsheets. Captured once at construction: build one transport per
   * client instance. Opaque to the library and distinct from `namespace`,
   * which only partitions local storage.
   *
   * Wire format:
   * - GAS: a trailing argument, `pullFn(table, context)` /
   *   `pushFn(table, mutations, context)`. Omitted entirely when unset.
   * - REST: one query parameter per entry on both the pull and the push URL;
   *   the push body stays `{ table, mutations }`.
   *
   * Carry an identifier the server validates and authorizes, never a resolved
   * resource id such as a spreadsheetId. Query parameters reach access logs,
   * so never put secrets here. A `table` key is rejected: it collides with the
   * pull URL's `table` parameter.
   */
  context?: Record<string, string>
}

type Operation = 'Pull' | 'Push'

/**
 * Encodes mutations into the JSON-safe form both push paths send (#245).
 *
 * `google.script.run` rejects any parameter holding a `Date`, top-level or
 * nested, while the REST path's `JSON.stringify` quietly turns one into its
 * ISO-8601 string. Running the GAS payload through the same JSON round trip
 * makes the two paths send identical values by construction (a `Date` becomes
 * `toISOString()`, `undefined` keys drop out) and matches what a queue restored
 * from storage already holds. It returns a fresh copy, so the batch the engine
 * keeps for retries and dead-lettering still holds the caller's `Date`s.
 */
const toWire = (mutations: readonly MergedMutation[]): unknown =>
  JSON.parse(JSON.stringify(mutations))

/** Whether `baseUrl` points at a deployed GAS web app */
function isGasWebAppUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname === GAS_WEB_APP_HOST
  } catch {
    // Relative or malformed URL: not a GAS web app.
    return false
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export class GasApiTransport implements SyncTransport {
  private readonly baseUrl?: string
  private readonly pullFn: string
  private readonly pushFn: string
  private readonly pushContentType: PushContentType
  private readonly timeoutMs: number
  private readonly context?: Readonly<Record<string, string>>

  constructor(options: GasApiTransportOptions = {}) {
    this.baseUrl = options.baseUrl
    this.pullFn = options.pullFn ?? 'syncPull'
    this.pushFn = options.pushFn ?? 'syncPush'
    this.pushContentType =
      options.pushContentType ??
      (isGasWebAppUrl(options.baseUrl) ? 'text/plain' : 'application/json')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (options.context !== undefined) {
      if (Object.prototype.hasOwnProperty.call(options.context, RESERVED_CONTEXT_KEY)) {
        throw new Error(
          `GasApiTransport: context must not contain the reserved key '${RESERVED_CONTEXT_KEY}' ` +
            '(it collides with the table query parameter)'
        )
      }
      // Copy so later changes to the caller's object never reach the wire.
      this.context = Object.freeze({ ...options.context })
    }
  }

  /** Whether `google.script.run` is available (running inside a GAS web app). */
  protected static isGas(): boolean {
    try {
      return typeof google !== 'undefined' && !!google?.script?.run
    } catch {
      return false
    }
  }

  async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    if (GasApiTransport.isGas()) {
      return this.gasPull<T>(tableName)
    }
    return this.fetchPull<T>(tableName)
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    if (GasApiTransport.isGas()) {
      return this.gasPush<T>(tableName, mutations)
    }
    return this.fetchPush<T>(tableName, mutations)
  }

  // ── GAS (google.script.run) ────────────────────────────────────────

  protected gasPull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    return new Promise((resolve, reject) => {
      const handler = google.script.run
        .withSuccessHandler((result: { rows: T[] }) => resolve(result))
        .withFailureHandler((error: Error) => reject(error))
      handler[this.pullFn](...this.gasArgs(tableName))
    })
  }

  protected gasPush<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    return new Promise((resolve, reject) => {
      const handler = google.script.run
        .withSuccessHandler((result: SyncPushResult<T>) => resolve(result))
        .withFailureHandler((error: Error) => reject(error))
      handler[this.pushFn](...this.gasArgs(tableName, toWire(mutations)))
    })
  }

  /** Server-function arguments, with the context appended only when set. */
  private gasArgs(...args: unknown[]): unknown[] {
    return this.context === undefined ? args : [...args, { ...this.context }]
  }

  // ── REST (fetch) ───────────────────────────────────────────────────

  protected async fetchPull<T extends RowWithId>(
    tableName: string
  ): Promise<{ rows: T[] }> {
    const query = `table=${encodeURIComponent(tableName)}${this.contextQuery('&')}`
    const url = this.baseUrl
      ? `${this.baseUrl}/sync/pull?${query}`
      : `/api/sync/pull?${query}`

    const body = await this.fetchJson('Pull', tableName, url, {})
    if (!isObject(body) || !Array.isArray(body.rows)) {
      throw new Error(
        `Pull failed: response for table '${tableName}' has no 'rows' array`
      )
    }
    return body as unknown as { rows: T[] }
  }

  protected async fetchPush<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    const query = this.contextQuery('?')
    const url = this.baseUrl
      ? `${this.baseUrl}/sync/push${query}`
      : `/api/sync/push${query}`

    const body = await this.fetchJson('Push', tableName, url, {
      method: 'POST',
      headers: { 'Content-Type': this.pushContentType },
      body: JSON.stringify({ table: tableName, mutations }),
    })
    if (!isObject(body) || typeof body.success !== 'boolean') {
      throw new Error(
        `Push failed: response for table '${tableName}' has no boolean 'success'`
      )
    }
    return body as unknown as SyncPushResult<T>
  }

  /**
   * One fetch request, read as JSON, under the timeout. Never retried: the
   * engine owns retries, and a second layer here would multiply attempts.
   */
  private async fetchJson(
    op: Operation,
    tableName: string,
    url: string,
    init: RequestInit
  ): Promise<unknown> {
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined
    let timedOut = false
    const timer = controller
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, this.timeoutMs)
      : undefined

    try {
      const res = await fetch(url, { ...init, signal: controller?.signal })
      if (!res.ok) {
        throw new Error(
          `${op} failed: ${res.status} ${res.statusText} for table '${tableName}'`
        )
      }

      // GAS serves its sign-in and error pages as HTTP 200 HTML, so a status
      // check alone lets them through to the JSON parser.
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.toLowerCase().includes('text/html')) {
        throw new Error(
          `${op} failed for table '${tableName}' (status ${res.status}): ` +
            'GAS returned an HTML page instead of JSON — check the deployment\'s ' +
            'access settings ("Who has access") and that the URL is the /exec URL'
        )
      }

      try {
        return await res.json()
      } catch (err) {
        if (timedOut) throw err
        throw new Error(
          `${op} failed: invalid JSON response for table '${tableName}' (status ${res.status})`
        )
      }
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `${op} failed: request for table '${tableName}' timed out after ${this.timeoutMs}ms`
        )
      }
      throw err
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * The context as URL-encoded `key=value` pairs, prefixed with `prefix`;
   * empty when there is no context or it has no entries.
   */
  private contextQuery(prefix: '?' | '&'): string {
    if (this.context === undefined) return ''
    const pairs = Object.entries(this.context).map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    return pairs.length === 0 ? '' : `${prefix}${pairs.join('&')}`
  }
}
