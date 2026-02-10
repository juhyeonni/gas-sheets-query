/**
 * Safe error conversion utility.
 * Handles unknown throw values (non-Error objects, strings, etc.)
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}
