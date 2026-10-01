/**
 * Client-mode id availability check shared by MockAdapter and LocalAdapter.
 */
import { DuplicateIdError } from './errors.js'

/**
 * True when `id` is already a key of `idIndex` under String-equality, so that
 * 1 and '1' collide while '1e3' and 1000 do not.
 */
function isTaken(idIndex: ReadonlyMap<string | number, unknown>, id: string | number): boolean {
  if (idIndex.has(id)) return true
  if (typeof id === 'number') return idIndex.has(String(id))
  return String(Number(id)) === id && idIndex.has(Number(id))
}

/**
 * Reject client-supplied ids that already exist in `idIndex`, or that repeat
 * within `ids`. Two ids collide iff `String(a) === String(b)`.
 *
 * Costs O(K) for K ids and reads only the id map, never the rows. Call it
 * before any mutation so a rejected write leaves the store untouched.
 *
 * @throws DuplicateIdError on the first colliding id
 */
export function assertClientIdsAvailable(
  idIndex: ReadonlyMap<string | number, unknown>,
  ids: readonly (string | number)[],
  tableName?: string
): void {
  const inBatch = new Set<string>()
  for (const id of ids) {
    const key = String(id)
    if (inBatch.has(key) || isTaken(idIndex, id)) {
      throw new DuplicateIdError(id, tableName)
    }
    inBatch.add(key)
  }
}
