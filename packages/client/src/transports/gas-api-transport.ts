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

export interface GasApiTransportOptions {
  /** Base URL for REST API (dev mode). If omitted, uses GAS. */
  baseUrl?: string
  /** GAS function name for sync pull (default: 'syncPull') */
  pullFn?: string
  /** GAS function name for sync push (default: 'syncPush') */
  pushFn?: string
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

const isGas = (): boolean => {
  try {
    return typeof google !== 'undefined' && !!google?.script?.run
  } catch {
    return false
  }
}

export class GasApiTransport implements SyncTransport {
  private readonly baseUrl?: string
  private readonly pullFn: string
  private readonly pushFn: string

  constructor(options: GasApiTransportOptions = {}) {
    this.baseUrl = options.baseUrl
    this.pullFn = options.pullFn ?? 'syncPull'
    this.pushFn = options.pushFn ?? 'syncPush'
  }

  async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    if (isGas()) {
      return this.gasPull<T>(tableName)
    }
    return this.fetchPull<T>(tableName)
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    if (isGas()) {
      return this.gasPush<T>(tableName, mutations)
    }
    return this.fetchPush<T>(tableName, mutations)
  }

  // ── GAS (google.script.run) ────────────────────────────────────────

  private gasPull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    return new Promise((resolve, reject) => {
      const handler = google.script.run
        .withSuccessHandler((result: { rows: T[] }) => resolve(result))
        .withFailureHandler((error: Error) => reject(error))
      ;(handler as any)[this.pullFn](tableName)
    })
  }

  private gasPush<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    return new Promise((resolve, reject) => {
      const handler = google.script.run
        .withSuccessHandler((result: SyncPushResult<T>) => resolve(result))
        .withFailureHandler((error: Error) => reject(error))
      ;(handler as any)[this.pushFn](tableName, toWire(mutations))
    })
  }

  // ── REST (fetch) ───────────────────────────────────────────────────

  private async fetchPull<T extends RowWithId>(
    tableName: string
  ): Promise<{ rows: T[] }> {
    const url = this.baseUrl
      ? `${this.baseUrl}/sync/pull?table=${encodeURIComponent(tableName)}`
      : `/api/sync/pull?table=${encodeURIComponent(tableName)}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Pull failed: ${res.status} ${res.statusText}`)
    try {
      return await res.json()
    } catch {
      throw new Error(`Pull failed: invalid JSON response for table '${tableName}' (status ${res.status})`)
    }
  }

  private async fetchPush<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    const url = this.baseUrl
      ? `${this.baseUrl}/sync/push`
      : `/api/sync/push`

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
}
