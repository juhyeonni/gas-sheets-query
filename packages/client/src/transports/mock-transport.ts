/**
 * MockTransport - In-memory SyncTransport for testing
 */
import type { RowWithId } from '@gsquery/core'
import type { SyncTransport, MergedMutation, ConflictItem } from '../local/sync-transport.js'

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
  ): Promise<{
    success: boolean
    conflicts?: ConflictItem<T>[]
  }> {
    if (this.pushShouldFail) {
      throw new Error(`MockTransport: push failed for ${tableName}`)
    }

    this.pushHistory.push({ tableName, mutations: [...mutations] })

    // Check for configured conflicts
    if (this.conflictGenerator) {
      const conflicts = this.conflictGenerator(tableName, mutations)
      if (conflicts.length > 0) {
        return { success: false, conflicts }
      }
    }

    // Apply mutations to server data
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
    return { success: true }
  }
}
