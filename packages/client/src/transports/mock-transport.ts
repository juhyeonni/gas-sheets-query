/**
 * MockTransport - In-memory SyncTransport for testing
 */
import type { RowWithId } from '@gsquery/core'
import type {
  SyncTransport,
  MergedMutation,
  ConflictItem,
  RowVersions,
  SyncPullResult,
  SyncPushResult,
} from '../local/sync-transport.js'

export interface MockTransportOptions {
  /**
   * Opt into row versions (#138), as the executable reference of the server
   * contract: every row has a numeric version that each applied write bumps,
   * pull and push return versions, a mutation without `baseVersion` is applied
   * unconditionally, and one whose `baseVersion` differs from the row's
   * current version is reported as a conflict instead of applied.
   * Off by default, which keeps the versionless wire format.
   */
  versioned?: boolean
}

export class MockTransport implements SyncTransport {
  /** Server-side data per table */
  readonly serverData = new Map<string, RowWithId[]>()

  /** Whether this mock versions rows (see {@link MockTransportOptions}) */
  readonly versioned: boolean

  /** Track push history for assertions */
  readonly pushHistory: Array<{
    tableName: string
    mutations: MergedMutation[]
  }> = []

  /** Configurable conflict generator */
  conflictGenerator?: <T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ) => ConflictItem<T>[]

  /** Configurable push failure */
  pushShouldFail = false
  pullShouldFail = false

  /**
   * Rows this "server" permanently refuses (a validation rule, say).
   *
   * A push containing one commits the rest and comes back with
   * `success: false`, `appliedIds` for what landed and `rejectedIds` naming the
   * offenders — the contract that lets a dead-lettered batch drop only the
   * poisoned rows instead of every mutation beside them (#174).
   */
  readonly rejectedIds = new Set<string | number>()

  /**
   * Whether a conflicting push still commits the mutations that did *not*
   * conflict. Off by default: the whole batch is rejected, which is the
   * conservative reading of the transport contract. When on, the applied rows
   * are reported back via `appliedIds` so the client clears exactly those.
   * Applies to version conflicts too.
   */
  applyNonConflictedOnConflict = false

  /** Row versions per table, keyed by `String(id)` (versioned mode only) */
  private readonly versions = new Map<string, Map<string, number>>()

  constructor(options: MockTransportOptions = {}) {
    this.versioned = options.versioned ?? false
  }

  /** Set server data for a table. In versioned mode every row starts at version 1. */
  setServerData<T extends RowWithId>(tableName: string, rows: T[]): void {
    this.serverData.set(tableName, [...rows])
    this.versions.set(tableName, new Map(rows.map(r => [String(r.id), 1])))
  }

  /** A row's current version (versioned mode), or `undefined` if the row is gone */
  getServerVersion(tableName: string, id: string | number): number | undefined {
    if (!this.versioned) return undefined
    const exists = (this.serverData.get(tableName) ?? []).some(r => r.id === id)
    return exists ? this.versionOf(tableName, id) : undefined
  }

  async pull<T extends RowWithId>(tableName: string): Promise<SyncPullResult<T>> {
    if (this.pullShouldFail) {
      throw new Error(`MockTransport: pull failed for ${tableName}`)
    }
    const rows = (this.serverData.get(tableName) ?? []) as T[]
    if (!this.versioned) return { rows: [...rows] }
    return { rows: [...rows], versions: this.versionsFor(tableName, rows.map(r => r.id)) }
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    if (this.pushShouldFail) {
      throw new Error(`MockTransport: push failed for ${tableName}`)
    }

    this.pushHistory.push({ tableName, mutations: [...mutations] })

    // Check for configured conflicts, then for stale base versions
    const generated = this.conflictGenerator?.(tableName, mutations) ?? []
    const generatedIds = new Set(generated.map(c => c.id))
    const conflicts = [
      ...generated,
      ...this.versionConflicts(
        tableName,
        mutations.filter(m => !generatedIds.has(m.id))
      ),
    ]
    if (conflicts.length > 0) {
      if (!this.applyNonConflictedOnConflict) {
        // Nothing was committed, so no appliedIds — the client keeps the
        // whole batch queued.
        return { success: false, conflicts }
      }
      const conflictIds = new Set(conflicts.map(c => c.id))
      const applied = mutations.filter(m => !conflictIds.has(m.id))
      this.applyMutations(tableName, applied)
      return this.withVersions(tableName, applied, {
        success: false,
        conflicts,
        appliedIds: applied.map(m => m.id),
      })
    }

    const refused = mutations.filter(m => this.rejectedIds.has(m.id))
    if (refused.length > 0) {
      const accepted = mutations.filter(m => !this.rejectedIds.has(m.id))
      this.applyMutations(tableName, accepted)
      return this.withVersions(tableName, accepted, {
        success: false,
        appliedIds: accepted.map(m => m.id),
        rejectedIds: refused.map(m => m.id),
      })
    }

    this.applyMutations(tableName, mutations)
    return this.withVersions(tableName, mutations, {
      success: true,
      appliedIds: mutations.map(m => m.id),
    })
  }

  /**
   * Conflicts for mutations whose `baseVersion` differs from the stored row's
   * current version. A mutation without a base, or for a row that does not
   * exist, is never a version conflict.
   */
  private versionConflicts<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): ConflictItem<T>[] {
    if (!this.versioned) return []
    const rows = (this.serverData.get(tableName) ?? []) as T[]
    const byId = new Map(rows.map(r => [r.id, r]))
    const conflicts: ConflictItem<T>[] = []
    for (const m of mutations) {
      if (m.baseVersion === undefined) continue
      const serverRow = byId.get(m.id)
      if (!serverRow) continue
      const serverVersion = this.versionOf(tableName, m.id)
      if (m.baseVersion !== serverVersion) {
        conflicts.push({ id: m.id, serverRow: { ...serverRow }, clientMutation: m, serverVersion })
      }
    }
    return conflicts
  }

  /** Attach the versions of the rows a push wrote (versioned mode only) */
  private withVersions<T extends RowWithId>(
    tableName: string,
    written: MergedMutation<T>[],
    result: SyncPushResult<T>
  ): SyncPushResult<T> {
    if (!this.versioned) return result
    const present = new Set((this.serverData.get(tableName) ?? []).map(r => r.id))
    const ids = written.map(m => m.id).filter(id => present.has(id))
    return { ...result, versions: this.versionsFor(tableName, ids) }
  }

  private versionsFor(tableName: string, ids: readonly (string | number)[]): RowVersions {
    const versions: RowVersions = {}
    for (const id of ids) versions[String(id)] = this.versionOf(tableName, id)
    return versions
  }

  private tableVersions(tableName: string): Map<string, number> {
    let table = this.versions.get(tableName)
    if (!table) {
      table = new Map()
      this.versions.set(tableName, table)
    }
    return table
  }

  /** A stored row's version; a row placed in `serverData` directly starts at 1 */
  private versionOf(tableName: string, id: string | number): number {
    return this.tableVersions(tableName).get(String(id)) ?? 1
  }

  private applyMutations<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): void {
    const current = [...(this.serverData.get(tableName) ?? [])] as T[]
    const byId = new Map(current.map(r => [r.id, r]))
    const versions = this.tableVersions(tableName)

    for (const m of mutations) {
      const key = String(m.id)
      if (m.type === 'insert') {
        // A re-created row continues from its last version instead of
        // restarting at 1, so a base taken before the delete never matches.
        const next = byId.has(m.id)
          ? this.versionOf(tableName, m.id) + 1
          : (versions.get(key) ?? 0) + 1
        byId.set(m.id, { id: m.id, ...m.data } as T)
        versions.set(key, next)
      } else if (m.type === 'update') {
        const existing = byId.get(m.id)
        if (existing) {
          byId.set(m.id, { ...existing, ...m.data })
          versions.set(key, this.versionOf(tableName, m.id) + 1)
        }
      } else if (m.type === 'delete') {
        // The version stays behind as a tombstone (see insert above).
        byId.delete(m.id)
      }
    }

    this.serverData.set(tableName, Array.from(byId.values()))
  }
}
