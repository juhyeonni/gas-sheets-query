/**
 * Sample-value wrappers for defineSheetsDB schemas (#200).
 *
 * A bare sample value can only say "this column holds a string" (or number,
 * boolean, Date). These wrappers add the two modifiers a sample cannot express:
 *
 * - `nullable(sample)`  → the column holds `T | null`
 * - `optional(sample)`  → the column is an optional key (`field?: T`)
 *
 * They carry a type only: `defineSheetsDB` never reads `types` at runtime, so
 * wrapping a sample changes no store, read or write behavior.
 */

/**
 * A plain sample value: `''` → string, `0` → number, `true` → boolean,
 * `new Date()` → Date, `null` → null.
 */
export type PrimitiveTypeSample = string | number | boolean | null | Date

/** A sample whose column also accepts `null`. Create it with {@link nullable}. */
export interface NullableSample<S extends PrimitiveTypeSample = PrimitiveTypeSample> {
  readonly kind: 'nullable'
  readonly sample: S
}

/** A sample whose column may be omitted. Create it with {@link optional}. */
export interface OptionalSample<
  S extends PrimitiveTypeSample | NullableSample = PrimitiveTypeSample | NullableSample
> {
  readonly kind: 'optional'
  readonly sample: S
}

/**
 * Mark a column as nullable: its type is the sample's type `| null`.
 *
 * @example
 * ```ts
 * types: { deletedAt: nullable(new Date()) }   // deletedAt: Date | null
 * ```
 */
export function nullable<const S extends PrimitiveTypeSample>(sample: S): NullableSample<S> {
  return Object.freeze({ kind: 'nullable', sample })
}

/**
 * Mark a column as optional: the row type gets an optional key, so `create()`
 * may omit it. Combine with {@link nullable} for an optional `T | null` key.
 *
 * @example
 * ```ts
 * types: {
 *   nickname: optional(''),            // nickname?: string
 *   score: optional(nullable(0))       // score?: number | null
 * }
 * ```
 */
export function optional<const S extends PrimitiveTypeSample | NullableSample>(
  sample: S
): OptionalSample<S> {
  return Object.freeze({ kind: 'optional', sample })
}
