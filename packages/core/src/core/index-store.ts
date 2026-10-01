/**
 * Index Store - Column index management
 *
 * Issue #7: Schema-based auto index creation and query utilization
 *
 * Structure:
 *   - Single column: "status" → Map<value, Set<key>>
 *   - Composite column: "field1|field2" → Map<serializeValues([val1, val2]), Set<key>>
 *
 * The key is the row position by default; MockAdapter and LocalAdapter use the
 * row id so that a delete never has to renumber other buckets.
 */

import type { Row, WhereCondition } from './types.js'
import { comparable } from './query-utils.js'

/** Index definition */
export interface IndexDefinition {
  /** Target fields for indexing (order matters) */
  fields: string[]
  /**
   * Declarative only: not enforced by any adapter. Indexes are used by
   * MockAdapter and LocalAdapter for `=` lookups and have no effect on SheetsAdapter.
   */
  unique?: boolean
}

/** Create index key (for composite indexes) */
export function createIndexKey(fields: string[]): string {
  return fields.join('|')
}

/**
 * Serialize values into a key with the same identity as the scan's `=`
 * comparison (`comparable()` + `===`): a Date equals its epoch number, while
 * 1 and '1', null and undefined stay distinct. Also used as the groupBy key.
 *
 * NaN and object/array values are out of scope: sheet cells hold only
 * primitives and Dates.
 */
export function serializeValues(values: unknown[]): string {
  return JSON.stringify(
    values.map(v => {
      const c = comparable(v)
      return [typeof c, String(c)]
    })
  )
}

/**
 * IndexStore - Per-table index management
 *
 * `K` is the bucket key type: the row position (`number`, the default) or any
 * stable row key such as an id. `rebuild` and `reindexAfterDelete` are
 * positional and only available on the default.
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
 * // Lookup: row positions where status='active'
 * const positions = store.lookup(['status'], ['active'])
 * ```
 */
export class IndexStore<T extends Row, K = number> {
  /** List of index definitions */
  private definitions: IndexDefinition[]

  /**
   * Index storage
   * key: "field1|field2|..." (index key)
   * value: Map<serializedValue, Set<key>>
   */
  private indexes: Map<string, Map<string, Set<K>>> = new Map()

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
  addToIndex(key: K, row: T): void {
    for (const def of this.definitions) {
      const indexName = createIndexKey(def.fields)
      const index = this.indexes.get(indexName)
      if (!index) continue

      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)

      let rowSet = index.get(serialized)
      if (!rowSet) {
        rowSet = new Set()
        index.set(serialized, rowSet)
      }
      rowSet.add(key)
    }
  }

  /**
   * Remove a single row from the index
   */
  removeFromIndex(key: K, row: T): void {
    for (const def of this.definitions) {
      const indexName = createIndexKey(def.fields)
      const index = this.indexes.get(indexName)
      if (!index) continue

      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)

      const rowSet = index.get(serialized)
      if (rowSet) {
        rowSet.delete(key)
        if (rowSet.size === 0) {
          index.delete(serialized)
        }
      }
    }
  }

  /**
   * Update index when a row is modified
   */
  updateIndex(key: K, oldRow: T, newRow: T): void {
    for (const def of this.definitions) {
      const indexName = createIndexKey(def.fields)
      const index = this.indexes.get(indexName)
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
          oldSet.delete(key)
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
        newSet.add(key)
      }
    }
  }

  /**
   * Rebuild indexes from all data
   */
  rebuild(this: IndexStore<T, number>, data: T[]): void {
    this.initializeIndexes()

    for (let i = 0; i < data.length; i++) {
      this.addToIndex(i, data[i])
    }
  }

  /**
   * Lookup row keys by field combination
   *
   * @param fields - Fields to search (must match index definition order)
   * @param values - Values to search (same order as fields)
   * @returns Matching row keys, or undefined if no index exists
   */
  lookup(fields: string[], values: unknown[]): Set<K> | undefined {
    const key = createIndexKey(fields)
    const index = this.indexes.get(key)

    if (!index) {
      return undefined // No index - full scan required
    }

    return index.get(serializeValues(values)) ?? new Set<K>()
  }

  /**
   * Narrow `=` conditions to candidate rows using the indexes.
   * Single-field lookups first (intersected), then the compound lookup over
   * all `=` conditions in where order.
   *
   * @returns Candidate keys (in no particular order; the caller orders them)
   *   plus the conditions the indexes did not cover, or undefined if no index
   *   applies
   */
  candidates(
    conditions: WhereCondition<T>[]
  ): { keys: K[]; remaining: WhereCondition<T>[] } | undefined {
    const eqConditions: Array<{ field: string; value: unknown; index: number }> = []
    conditions.forEach((cond, i) => {
      if (cond.operator === '=') {
        eqConditions.push({ field: cond.field, value: cond.value, index: i })
      }
    })
    if (eqConditions.length === 0) return undefined

    let used: Set<K> | undefined
    const usedConditionIndices = new Set<number>()
    const intersect = (found: Set<K>): void => {
      used = used === undefined
        ? new Set(found)
        : new Set([...used].filter(k => found.has(k)))
    }

    for (const eq of eqConditions) {
      const found = this.lookup([eq.field], [eq.value])
      if (found !== undefined) {
        intersect(found)
        usedConditionIndices.add(eq.index)
      }
    }

    if (eqConditions.length >= 2) {
      const found = this.lookup(
        eqConditions.map(eq => eq.field),
        eqConditions.map(eq => eq.value)
      )
      if (found !== undefined) {
        intersect(found)
        eqConditions.forEach(eq => usedConditionIndices.add(eq.index))
      }
    }

    if (used === undefined) return undefined
    return {
      keys: [...(used as Set<K>)],
      remaining: conditions.filter((_, i) => !usedConditionIndices.has(i)),
    }
  }

  /**
   * Reindex after delete
   * Row indices after the deleted row shift down due to splice
   */
  reindexAfterDelete(this: IndexStore<T, number>, deletedIndex: number): void {
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
  debugDump(): Record<string, Record<string, K[]>> {
    const result: Record<string, Record<string, K[]>> = {}

    for (const [key, index] of this.indexes) {
      result[key] = {}
      for (const [serialized, rowSet] of index) {
        result[key][serialized] = Array.from(rowSet)
      }
    }

    return result
  }
}
