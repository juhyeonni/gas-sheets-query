/**
 * Index Store - Column index management
 *
 * Issue #7: Schema-based auto index creation and query utilization
 *
 * Structure:
 *   - Single column: "status" → Map<value, Set<rowIndex>>
 *   - Composite column: "field1|field2" → Map<JSON([val1, val2]), Set<rowIndex>>
 */

import type { Row } from './types'

/** Index definition */
export interface IndexDefinition {
  /** Target fields for indexing (order matters) */
  fields: string[]
  /** Whether to enforce uniqueness */
  unique?: boolean
}

/** Create index key (for composite indexes) */
export function createIndexKey(fields: string[]): string {
  return fields.join('|')
}

/** Serialize composite values */
export function serializeValues(values: unknown[]): string {
  return JSON.stringify(values)
}

/**
 * IndexStore - Per-table index management
 *
 * @example
 * ```ts
 * const store = new IndexStore<User>([
 *   { fields: ['status'] },
 *   { fields: ['email'], unique: true },
 *   { fields: ['role', 'status'] }  // composite index
 * ])
 *
 * // Build index when loading data
 * store.rebuild(users)
 *
 * // Lookup: row indices where status='active'
 * const indices = store.lookup(['status'], ['active'])
 * ```
 */
export class IndexStore<T extends Row> {
  /** List of index definitions */
  private definitions: IndexDefinition[]

  /**
   * Index storage
   * key: "field1|field2|..." (index key)
   * value: Map<serializedValue, Set<rowIndex>>
   */
  private indexes: Map<string, Map<string, Set<number>>> = new Map()

  constructor(definitions: IndexDefinition[] = []) {
    this.definitions = definitions
    this.initializeIndexes()
  }

  /** Initialize index structure */
  private initializeIndexes(): void {
    this.indexes.clear()
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      this.indexes.set(key, new Map())
    }
  }

  /** Get index definitions */
  getDefinitions(): IndexDefinition[] {
    return [...this.definitions]
  }

  /** Check if an index exists for the given field combination */
  hasIndex(fields: string[]): boolean {
    const key = createIndexKey(fields)
    return this.indexes.has(key)
  }

  /**
   * Extract values for specific fields from a row
   */
  private extractValues(row: T, fields: string[]): unknown[] {
    return fields.map(f => row[f])
  }

  /**
   * Add a single row to the index
   */
  addToIndex(rowIndex: number, row: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue

      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)

      let rowSet = index.get(serialized)
      if (!rowSet) {
        rowSet = new Set()
        index.set(serialized, rowSet)
      }
      rowSet.add(rowIndex)
    }
  }

  /**
   * Remove a single row from the index
   */
  removeFromIndex(rowIndex: number, row: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue

      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)

      const rowSet = index.get(serialized)
      if (rowSet) {
        rowSet.delete(rowIndex)
        if (rowSet.size === 0) {
          index.delete(serialized)
        }
      }
    }
  }

  /**
   * Update index when a row is modified
   */
  updateIndex(rowIndex: number, oldRow: T, newRow: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue

      const oldValues = this.extractValues(oldRow, def.fields)
      const newValues = this.extractValues(newRow, def.fields)
      const oldSerialized = serializeValues(oldValues)
      const newSerialized = serializeValues(newValues)

      // Only update index if values changed
      if (oldSerialized !== newSerialized) {
        // Remove from old value
        const oldSet = index.get(oldSerialized)
        if (oldSet) {
          oldSet.delete(rowIndex)
          if (oldSet.size === 0) {
            index.delete(oldSerialized)
          }
        }

        // Add to new value
        let newSet = index.get(newSerialized)
        if (!newSet) {
          newSet = new Set()
          index.set(newSerialized, newSet)
        }
        newSet.add(rowIndex)
      }
    }
  }

  /**
   * Rebuild indexes from all data
   */
  rebuild(data: T[]): void {
    this.initializeIndexes()

    for (let i = 0; i < data.length; i++) {
      this.addToIndex(i, data[i])
    }
  }

  /**
   * Lookup row indices by field combination
   *
   * @param fields - Fields to search (must match index definition order)
   * @param values - Values to search (same order as fields)
   * @returns Matching row indices, or undefined if no index exists
   */
  lookup(fields: string[], values: unknown[]): Set<number> | undefined {
    const key = createIndexKey(fields)
    const index = this.indexes.get(key)

    if (!index) {
      return undefined // No index - full scan required
    }

    const serialized = serializeValues(values)
    return index.get(serialized) // Set or undefined
  }

  /**
   * Find index starting with specific fields (prefix matching)
   * Used for prefix matching in composite indexes
   */
  findIndexByPrefix(fields: string[]): IndexDefinition | undefined {
    const prefix = fields.join('|')

    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      if (key === prefix || key.startsWith(prefix + '|')) {
        return def
      }
    }

    return undefined
  }

  /**
   * Reindex after delete
   * Row indices after the deleted row shift down due to splice
   */
  reindexAfterDelete(deletedIndex: number): void {
    for (const [, index] of this.indexes) {
      for (const [, rowSet] of index) {
        const updated = new Set<number>()
        for (const idx of rowSet) {
          if (idx < deletedIndex) {
            updated.add(idx)
          } else if (idx > deletedIndex) {
            updated.add(idx - 1) // shift down
          }
          // idx === deletedIndex already removed
        }
        rowSet.clear()
        for (const idx of updated) {
          rowSet.add(idx)
        }
      }
    }
  }

  /** Clear all indexes */
  clear(): void {
    this.initializeIndexes()
  }

  /** Debug: dump index state */
  debugDump(): Record<string, Record<string, number[]>> {
    const result: Record<string, Record<string, number[]>> = {}

    for (const [key, index] of this.indexes) {
      result[key] = {}
      for (const [serialized, rowSet] of index) {
        result[key][serialized] = Array.from(rowSet)
      }
    }

    return result
  }
}
