/**
 * Compile-time assertion helpers for the type tests in this directory.
 *
 * These files are never run: `pnpm typecheck` compiles them through
 * tsconfig.type-tests.json, so a positive case that stops compiling, or a
 * `@ts-expect-error` case that starts compiling, fails CI.
 */

/** True when A and B are the same type */
export type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false

/** Compiles only when T is true */
export type Expect<T extends true> = T

/** True when K is a key of T */
export type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false

/** True when K is not a key of T */
export type LacksKey<T, K extends PropertyKey> = K extends keyof T ? false : true
