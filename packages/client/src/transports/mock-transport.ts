/**
 * MockTransport - In-memory SyncTransport for testing
 */
import type { RowWithId } from '@gsquery/core'
import type {
  SyncTransport,
  MergedMutation,
  ConflictItem,
  SyncPushResult,
} from '../local/sync-transport.js'

export class MockTransport implements SyncTransport {
  /** Server-side data per table */
  readonly serverData = new Map<string, RowWithId[]>()

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
   */
  applyNonConflictedOnConflict = false

  /** Set server data for a table */
  setServerData<T extends RowWithId>(tableName: string, rows: T[]): void {
    this.serverData.set(tableName, [...rows])
  }

  async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    if (this.pullShouldFail) {
      throw new Error(`MockTransport: pull failed for ${tableName}`)
    }
    const rows = (this.serverData.get(tableName) ?? []) as T[]
    return { rows: [...rows] }
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    if (this.pushShouldFail) {
      throw new Error(`MockTransport: push failed for ${tableName}`)
    }

    this.pushHistory.push({ tableName, mutations: [...mutations] })

    // Check for configured conflicts
    if (this.conflictGenerator) {
      const conflicts = this.conflictGenerator(tableName, mutations)
      if (conflicts.length > 0) {
        if (!this.applyNonConflictedOnConflict) {
          // Nothing was committed, so no appliedIds — the client keeps the
          // whole batch queued.
          return { success: false, conflicts }
        }
        const conflictIds = new Set(conflicts.map(c => c.id))
        const applied = mutations.filter(m => !conflictIds.has(m.id))
        this.applyMutations(tableName, applied)
        return { success: false, conflicts, appliedIds: applied.map(m => m.id) }
      }
    }

    const refused = mutations.filter(m => this.rejectedIds.has(m.id))
    if (refused.length > 0) {
      const accepted = mutations.filter(m => !this.rejectedIds.has(m.id))
      this.applyMutations(tableName, accepted)
      return {
        success: false,
        appliedIds: accepted.map(m => m.id),
        rejectedIds: refused.map(m => m.id),
      }
    }

    this.applyMutations(tableName, mutations)
    return { success: true, appliedIds: mutations.map(m => m.id) }
  }

  private applyMutations<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): void {
    const current = [...(this.serverData.get(tableName) ?? [])] as T[]
    const byId = new Map(current.map(r => [r.id, r]))

    for (const m of mutations) {
      if (m.type === 'insert') {
        byId.set(m.id, { id: m.id, ...m.data } as T)
      } else if (m.type === 'update') {
        const existing = byId.get(m.id) as T | undefined
        if (existing) {
          byId.set(m.id, { ...existing, ...m.data })
        }
      } else if (m.type === 'delete') {
        byId.delete(m.id)
      }
    }

    this.serverData.set(tableName, Array.from(byId.values()))
  }
}
