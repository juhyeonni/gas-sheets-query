/**
 * SyncEngine - Async pull/push/reconcile with event system and debounce
 */
import type { RowWithId } from '@gsquery/core'
import type {
  SyncTransport,
  SyncEvent,
  SyncEventListener,
  ConflictStrategy,
  ConflictItem,
  MergedMutation,
} from './sync-transport.js'
import type { LocalAdapter } from './local-adapter.js'
import type { MutationQueue } from './mutation-queue.js'

export interface SyncEngineOptions {
  transport: SyncTransport
  conflictStrategy?: ConflictStrategy
  /** Debounce ms for auto-push after mutations (default: 0 = disabled) */
  pushDebounceMs?: number
}

interface TableBinding {
  adapter: LocalAdapter<any>
  queue: MutationQueue<any>
}

export class SyncEngine {
  private readonly transport: SyncTransport
  private readonly conflictStrategy: ConflictStrategy
  private readonly tables = new Map<string, TableBinding>()

  private readonly listeners: SyncEventListener[] = []
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private pushDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pushDebounceMs: number
  private syncing = false

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport
    this.conflictStrategy = options.conflictStrategy ?? 'server-wins'
    this.pushDebounceMs = options.pushDebounceMs ?? 0
  }

  /** Register a table for sync */
  registerTable<T extends RowWithId>(
    tableName: string,
    adapter: LocalAdapter<T>,
    queue: MutationQueue<T>
  ): void {
    this.tables.set(tableName, { adapter, queue })
  }

  /** Subscribe to sync events */
  on(listener: SyncEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Don't let listener errors break sync
      }
    }
  }

  /** Full sync: push first (preserve local changes), then pull */
  async sync(tableName?: string): Promise<void> {
    if (this.syncing) return
    this.syncing = true

    try {
      this.emit({ type: 'sync-start', table: tableName })

      const tableNames = tableName
        ? [tableName]
        : Array.from(this.tables.keys())

      for (const name of tableNames) {
        await this.pushTable(name)
        await this.pullTable(name)
      }

      this.emit({ type: 'sync-complete', table: tableName })
    } catch (err) {
      this.emit({
        type: 'error',
        table: tableName,
        error: err instanceof Error ? err : new Error(String(err)),
      })
      throw err
    } finally {
      this.syncing = false
    }
  }

  /** Push local mutations to server */
  async push(tableName?: string): Promise<void> {
    const tableNames = tableName
      ? [tableName]
      : Array.from(this.tables.keys())

    for (const name of tableNames) {
      await this.pushTable(name)
    }
  }

  /** Pull server data to local */
  async pull(tableName?: string): Promise<void> {
    const tableNames = tableName
      ? [tableName]
      : Array.from(this.tables.keys())

    for (const name of tableNames) {
      await this.pullTable(name)
    }
  }

  private async pushTable(tableName: string): Promise<void> {
    const binding = this.tables.get(tableName)
    if (!binding) return

    const merged = binding.queue.getMerged()
    if (merged.length === 0) return

    const result = await this.transport.push(tableName, merged)

    if (result.success) {
      // Clear synced mutations
      const syncedIds = new Set(merged.map(m => m.id))
      binding.queue.clearForRows(syncedIds)
      this.emit({ type: 'push-complete', table: tableName, pushedCount: merged.length })
    } else if (result.conflicts && result.conflicts.length > 0) {
      // Handle conflicts
      this.resolveConflicts(tableName, binding, result.conflicts, merged)
      // Clear synced mutations (conflicts resolved)
      const syncedIds = new Set(merged.map(m => m.id))
      binding.queue.clearForRows(syncedIds)
      this.emit({ type: 'push-complete', table: tableName, pushedCount: merged.length })
    }
  }

  private resolveConflicts(
    _tableName: string,
    binding: TableBinding,
    conflicts: ConflictItem[],
    _merged: MergedMutation[]
  ): void {
    for (const conflict of conflicts) {
      let resolvedRow: RowWithId

      if (typeof this.conflictStrategy === 'function') {
        resolvedRow = this.conflictStrategy(conflict)
      } else if (this.conflictStrategy === 'client-wins') {
        // Keep local version (already in adapter)
        continue
      } else {
        // server-wins (default)
        resolvedRow = conflict.serverRow
      }

      // Apply resolved row to local adapter (without recording mutation)
      const existing = binding.adapter.findById(conflict.id)
      if (existing) {
        const allData = binding.adapter.getRawData()
        const idx = allData.findIndex((r: RowWithId) => r.id === conflict.id)
        if (idx >= 0) {
          allData[idx] = resolvedRow
          binding.adapter.replaceAll(allData)
        }
      }
    }
  }

  private async pullTable(tableName: string): Promise<void> {
    const binding = this.tables.get(tableName)
    if (!binding) return

    const { rows } = await this.transport.pull(tableName)

    // If there are pending local mutations, apply them on top of server data
    const merged = binding.queue.getMerged()
    if (merged.length > 0) {
      const serverMap = new Map(rows.map(r => [r.id, r]))

      // Apply pending mutations on top of server data
      for (const m of merged) {
        if (m.type === 'insert') {
          if (!serverMap.has(m.id)) {
            serverMap.set(m.id, { id: m.id, ...m.data } as RowWithId)
          }
        } else if (m.type === 'update') {
          const existing = serverMap.get(m.id)
          if (existing) {
            serverMap.set(m.id, { ...existing, ...m.data })
          }
        } else if (m.type === 'delete') {
          serverMap.delete(m.id)
        }
      }

      binding.adapter.replaceAll(Array.from(serverMap.values()) as any[])
    } else {
      binding.adapter.replaceAll(rows as any[])
    }

    this.emit({ type: 'pull-complete', table: tableName, pulledCount: rows.length })
  }

  /** Schedule a debounced push (called after local mutations) */
  schedulePush(): void {
    if (this.pushDebounceMs <= 0) return
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer)
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = null
      this.push().catch(() => {
        // Push failed - will retry on next sync
      })
    }, this.pushDebounceMs)
  }

  /** Start auto-sync at interval */
  startAutoSync(intervalMs: number): void {
    this.stopAutoSync()
    this.autoSyncTimer = setInterval(() => {
      this.sync().catch(() => {
        // Sync failed - will retry on next interval
      })
    }, intervalMs)
  }

  /** Stop auto-sync */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /** Check if currently syncing */
  get isSyncing(): boolean {
    return this.syncing
  }

  /** Cleanup */
  dispose(): void {
    this.stopAutoSync()
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer)
      this.pushDebounceTimer = null
    }
    this.listeners.length = 0
  }
}
