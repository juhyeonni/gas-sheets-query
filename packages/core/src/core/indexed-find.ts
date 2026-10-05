/**
 * Indexed `find` shared by the in-memory stores (MockAdapter, LocalAdapter).
 *
 * Both keep the same three structures: the rows in scan order, an id -> row
 * position map, and an {@link IndexStore} keyed by row id. This function is
 * the one place that turns them into a query result (#195).
 */
import type { QueryOptions, RowWithId } from './types.js'
import type { IndexStore } from './index-store.js'
import { applyQuery } from './query-utils.js'

/**
 * Map indexed row ids to row positions, sorted into scan order so an indexed
 * find returns rows in the same order as a full scan.
 *
 * @throws Error when an id is missing from `idIndex` (the indexes are out of sync)
 */
function positionsOf(
  keys: readonly (string | number)[],
  idIndex: ReadonlyMap<string | number, number>
): number[] {
  const positions: number[] = []
  for (const key of keys) {
    const pos = idIndex.get(key)
    if (pos === undefined) {
      throw new Error(`IndexStore out of sync: id ${String(key)} not in idIndex`)
    }
    positions.push(pos)
  }
  return positions.sort((x, y) => x - y)
}

/**
 * Run a query over `rows`, narrowing `=` conditions through `indexStore` when
 * an index covers them and scanning every row otherwise. The result is the
 * same, in the same order, as `applyQuery(rows, options.where, options)`.
 *
 * `idIndex` maps each id the indexes hold to its position in `rows`, and
 * `indexStore` must hold exactly those rows (for seeded rows sharing an id,
 * the one `idIndex` points to).
 *
 * Never mutates `rows` and always returns a new array.
 */
export function findWithIndexes<T extends RowWithId>(
  rows: readonly T[],
  idIndex: ReadonlyMap<string | number, number>,
  indexStore: IndexStore<T, string | number>,
  options: QueryOptions<T>
): T[] {
  if (options.where.length > 0) {
    const narrowed = indexStore.candidates(options.where)
    if (narrowed !== undefined) {
      const candidates: T[] = []
      for (const pos of positionsOf(narrowed.keys, idIndex)) {
        candidates.push(rows[pos])
      }
      return applyQuery(candidates, narrowed.remaining, options)
    }
  }
  return applyQuery(rows, options.where, options)
}
