/**
 * Column defaults and `@updatedAt` stamps (#199).
 *
 * Applied once, by `Repository`, so every adapter gets the same behavior.
 * The rules:
 * - A default fills a field only when it is missing or `undefined`; any value
 *   the caller supplies (including `null`, `false`, `0` and `''`) is kept.
 * - `@updatedAt` follows the same rule on insert and on update.
 * - `id` is never filled or stamped: `idMode` owns ids.
 * - The caller's object is never mutated; a copy is returned when anything
 *   applies, and the input itself when nothing does.
 * - One write uses one `now`: every row and field of one call gets the same
 *   instant, each in its own `Date` object.
 */
import type { ColumnDefault } from './types.js'

/** Runtime defaults and `@updatedAt` fields of one table */
export interface WriteDefaults {
  /** Values filled on insert when a field is missing or `undefined` */
  defaults?: Record<string, ColumnDefault>
  /** Fields stamped with the write's `Date` on insert and update */
  updatedAt?: readonly string[]
}

const ID_FIELD = 'id'

/**
 * Normalized form of {@link WriteDefaults}: `id` removed, empty lists dropped.
 * `undefined` when nothing would ever apply, so callers can skip all work and
 * hand their input to the store untouched.
 */
export interface CompiledWriteDefaults {
  readonly defaults: ReadonlyArray<readonly [string, ColumnDefault]>
  readonly updatedAt: readonly string[]
}

export function compileWriteDefaults(spec: WriteDefaults | undefined): CompiledWriteDefaults | undefined {
  if (!spec) return undefined
  const defaults = Object.entries(spec.defaults ?? {}).filter(([field]) => field !== ID_FIELD)
  const updatedAt = (spec.updatedAt ?? []).filter(field => field !== ID_FIELD)
  if (defaults.length === 0 && updatedAt.length === 0) return undefined
  return { defaults, updatedAt }
}

function resolveDefault(def: ColumnDefault, now: Date): unknown {
  return def.kind === 'now' ? new Date(now.getTime()) : def.value
}

/**
 * Copy of `data` with absent defaulted fields filled and absent `@updatedAt`
 * fields stamped with `now`. Returns `data` itself when there is nothing to apply.
 */
export function applyInsertDefaults<D>(data: D, compiled: CompiledWriteDefaults | undefined, now: Date): D {
  if (!compiled) return data
  const row: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const [field, def] of compiled.defaults) {
    if (row[field] === undefined) row[field] = resolveDefault(def, now)
  }
  for (const field of compiled.updatedAt) {
    if (row[field] === undefined) row[field] = new Date(now.getTime())
  }
  return row as D
}

/**
 * Copy of the update patch with absent `@updatedAt` fields stamped with `now`.
 * Defaults are never applied to a patch: they would overwrite the stored row.
 * Returns `patch` itself when there are no `@updatedAt` fields.
 */
export function applyUpdateStamp<D>(patch: D, compiled: CompiledWriteDefaults | undefined, now: Date): D {
  if (!compiled || compiled.updatedAt.length === 0) return patch
  const next: Record<string, unknown> = { ...(patch as Record<string, unknown>) }
  for (const field of compiled.updatedAt) {
    if (next[field] === undefined) next[field] = new Date(now.getTime())
  }
  return next as D
}
