/**
 * Type-level tests for the nullable() / optional() sample wrappers (#200).
 *
 * This file is never executed: it is compiled by the core typecheck
 * (`tsconfig.type-tests.json`), which CI runs. Every `@ts-expect-error` below
 * must stay live, and every `Expect<Equal<...>>` must hold, or the typecheck
 * fails.
 */
import {
  defineSheetsDB,
  nullable,
  optional,
  type InferType,
  type InferRowFromSchema
} from '../../src/index.js'

// ----------------------------------------------------------------------------
// Assertion helpers
// ----------------------------------------------------------------------------

type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

/** Flattens an intersection so Equal compares the resulting object shape. */
type Flat<T> = { [K in keyof T]: T[K] }

// ----------------------------------------------------------------------------
// AC6: existing sample inference is unchanged
// ----------------------------------------------------------------------------

export type AC6 = [
  Expect<Equal<InferType<''>, string>>,
  Expect<Equal<InferType<0>, number>>,
  Expect<Equal<InferType<true>, boolean>>,
  Expect<Equal<InferType<Date>, Date>>,
  Expect<Equal<InferType<null>, null>>
]

// ----------------------------------------------------------------------------
// Wrapper inference
// ----------------------------------------------------------------------------

const nullableString = nullable('')
const optionalString = optional('')
const optionalNullableNumber = optional(nullable(0))

export type WrapperInference = [
  Expect<Equal<InferType<typeof nullableString>, string | null>>,
  Expect<Equal<InferType<typeof optionalString>, string>>,
  Expect<Equal<InferType<typeof optionalNullableNumber>, number | null>>,
  Expect<Equal<InferType<ReturnType<typeof nullable<Date>>>, Date | null>>
]

// ----------------------------------------------------------------------------
// Row inference
// ----------------------------------------------------------------------------

const memberSchema = {
  columns: ['id', 'name', 'deletedAt', 'nickname', 'score'] as const,
  types: {
    id: 0,
    name: '',
    deletedAt: nullable(''),
    nickname: optional(''),
    score: optional(nullable(0))
  }
}

type Member = InferRowFromSchema<typeof memberSchema>

export type RowInference = [
  // AC3: the optional column is an optional key that reads as `string | undefined`
  Expect<Equal<Member['nickname'], string | undefined>>,
  // AC4: optional(nullable(0)) is an optional `number | null` key
  Expect<Equal<Member['score'], number | null | undefined>>,
  Expect<Equal<
    Flat<Member>,
    {
      // `types.id: 0` narrows the `{ id: string | number }` intersection to number
      id: number
      name: string
      deletedAt: string | null
      nickname?: string
      score?: number | null
    }
  >>
]

// ----------------------------------------------------------------------------
// Table handle usage
// ----------------------------------------------------------------------------

export function tableHandleUsage(): void {
  const db = defineSheetsDB({
    tables: {
      members: {
        columns: ['id', 'name', 'deletedAt', 'nickname', 'score'] as const,
        types: {
          id: 0,
          name: '',
          deletedAt: nullable(''),
          nickname: optional(''),
          score: optional(nullable(0))
        }
      }
    },
    mock: true
  })
  const members = db.from('members')

  // AC1: null and a string both fit a nullable('') column, on create and update
  const a = members.create({ name: 'a', deletedAt: null })
  members.create({ name: 'b', deletedAt: '2024-01-01' })
  members.update(a.id, { deletedAt: null })

  // AC2: a number does not fit a nullable('') column
  // @ts-expect-error -- number is not string | null
  members.create({ name: 'c', deletedAt: 1 })
  // @ts-expect-error -- number is not string | null
  members.update(a.id, { deletedAt: 1 })

  // A nullable column is still required: it is not optional
  // @ts-expect-error -- deletedAt is missing
  members.create({ name: 'd' })

  // AC3: the optional column may be omitted, and reads as string | undefined
  const nickname: string | undefined = a.nickname
  void nickname
  // @ts-expect-error -- an optional('') column does not accept null
  members.create({ name: 'e', deletedAt: null, nickname: null })

  // AC4: optional(nullable(0)) accepts a number, null, or nothing
  members.create({ name: 'f', deletedAt: null, score: 1 })
  members.create({ name: 'g', deletedAt: null, score: null })
  // @ts-expect-error -- a string is not number | null
  members.create({ name: 'h', deletedAt: null, score: 'x' })

  // AC5: a nullable column can be queried for null
  members.query().where('deletedAt', '=', null).exec()
  members.query().where('deletedAt', '=', '2024-01-01').exec()
  // @ts-expect-error -- number is not string | null
  members.query().where('deletedAt', '=', 1).exec()
}
