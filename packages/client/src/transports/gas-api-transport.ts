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

declare const google: {
  script: {
    run: {
      withSuccessHandler: <T>(callback: (result: T) => void) => {
        withFailureHandler: (callback: (error: Error) => void) => {
          [key: string]: (...args: unknown[]) => void
        }
      }
    }
  }
}

/**
 * Query parameter the REST pull already uses for the table name. A context
 * entry with this key would collide with it, so the constructor rejects it.
 */
const RESERVED_CONTEXT_KEY = 'table'

export interface GasApiTransportOptions {
  /** Base URL for REST API (dev mode). If omitted, uses GAS. */
  baseUrl?: string
  /** GAS function name for sync pull (default: 'syncPull') */
  pullFn?: string
  /** GAS function name for sync push (default: 'syncPush') */
  pushFn?: string
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

export class GasApiTransport implements SyncTransport {
  private readonly baseUrl?: string
  private readonly pullFn: string
  private readonly pushFn: string
  private readonly context?: Readonly<Record<string, string>>

  constructor(options: GasApiTransportOptions = {}) {
    this.baseUrl = options.baseUrl
    this.pullFn = options.pullFn ?? 'syncPull'
    this.pushFn = options.pushFn ?? 'syncPush'

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

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Pull failed: ${res.status} ${res.statusText}`)
    try {
      return await res.json()
    } catch {
      throw new Error(`Pull failed: invalid JSON response for table '${tableName}' (status ${res.status})`)
    }
  }

  protected async fetchPush<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    const query = this.contextQuery('?')
    const url = this.baseUrl
      ? `${this.baseUrl}/sync/push${query}`
      : `/api/sync/push${query}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: tableName, mutations }),
    })
    if (!res.ok) throw new Error(`Push failed: ${res.status} ${res.statusText}`)
    try {
      return await res.json()
    } catch {
      throw new Error(`Push failed: invalid JSON response for table '${tableName}' (status ${res.status})`)
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
