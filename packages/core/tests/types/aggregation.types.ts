/**
 * Type tests for aggregation fields and grouped results (#194, AC4, AC5, AC7, AC8)
 *
 * Compiled by `pnpm typecheck` (tsconfig.type-tests.json), never run.
 */
import { defineSheetsDB, createQueryBuilder, MockAdapter } from '../../src'
import type { AggSpec, NumericColumn, QueryBuilder } from '../../src'
import type { Equal, Expect, HasKey, LacksKey } from './assert'

interface Employee {
  id: number
  name: string
  role: string
  city: string
  salary: number
  bonus: number | null
  rating?: number
  level: 1 | 2 | 3
  code: string | number
  joined: Date
  active: boolean
}

const q = createQueryBuilder(new MockAdapter<Employee>())

// ---------------------------------------------------------------------------
// NumericColumn: the columns whose type can hold a number
// ---------------------------------------------------------------------------

type _numeric = Expect<Equal<
  NumericColumn<Employee>,
  'id' | 'salary' | 'bonus' | 'rating' | 'level' | 'code'
>>

// ---------------------------------------------------------------------------
// AC4: agg() spec fields are number columns, nullable or optional included
// ---------------------------------------------------------------------------

q.agg({
  n: 'count',
  total: 'sum:salary',
  avgBonus: 'avg:bonus',
  minRating: 'min:rating',
  maxLevel: 'max:level'
})

// @ts-expect-error unknown column
q.agg({ total: 'sum:not_a_column' })
// @ts-expect-error unknown column
q.agg({ total: 'avg:salry' })
// @ts-expect-error string-only column
q.agg({ total: 'sum:name' })
// @ts-expect-error string-only column
q.agg({ total: 'min:city' })
// @ts-expect-error Date column
q.agg({ total: 'max:joined' })
// @ts-expect-error boolean column
q.agg({ total: 'avg:active' })
// @ts-expect-error not a spec at all
q.agg({ total: 'median:salary' })

// ---------------------------------------------------------------------------
// AC5: sum()/avg()/min()/max() take a number column
// ---------------------------------------------------------------------------

const _sum: number = q.sum('salary')
const _avg: number | null = q.avg('bonus')
const _min: number | null = q.min('rating')
const _max: number | null = q.max('level')

// @ts-expect-error string-only column
q.sum('name')
// @ts-expect-error string-only column
q.avg('city')
// @ts-expect-error string-only column
q.min('role')
// @ts-expect-error string-only column
q.max('name')
// @ts-expect-error unknown column
q.sum('nope')

// ---------------------------------------------------------------------------
// AC7: agg() results expose the groupBy() keys and the spec names only
// ---------------------------------------------------------------------------

const [byRole] = q.groupBy('role').agg({ total: 'count' })
const _role: unknown = byRole.role
const _total: number = byRole.total
// @ts-expect-error not a group key
byRole.city
type _byRoleKeys = Expect<Equal<keyof typeof byRole, 'role' | 'total'>>

const [ungrouped] = q.agg({ total: 'count', payroll: 'sum:salary' })
type _ungroupedKeys = Expect<Equal<keyof typeof ungrouped, 'total' | 'payroll'>>
// @ts-expect-error without groupBy() only the spec names exist
ungrouped.role

const [byTwo] = q.groupBy('role', 'city').agg({ n: 'count' })
type _byTwoKeys = Expect<Equal<keyof typeof byTwo, 'role' | 'city' | 'n'>>

const [fromClone] = q.groupBy('role', 'city').clone().agg({ n: 'count' })
type _cloneKeys = Expect<Equal<keyof typeof fromClone, 'role' | 'city' | 'n'>>

// A second groupBy() replaces the keys, as at runtime
const [regrouped] = q.groupBy('role').groupBy('city').agg({ n: 'count' })
type _regroupedHasCity = Expect<HasKey<typeof regrouped, 'city'>>
type _regroupedLacksRole = Expect<LacksKey<typeof regrouped, 'role'>>

// Chaining after groupBy() keeps the keys
const [chained] = q.groupBy('role').where('active', '=', true).having('n', '>', 1).agg({ n: 'count' })
type _chainedKeys = Expect<Equal<keyof typeof chained, 'role' | 'n'>>

// ---------------------------------------------------------------------------
// AC8: existing annotations, the bare AggSpec and documented examples
// ---------------------------------------------------------------------------

// A builder stored in a variable annotated QueryBuilder<T>
let annotated: QueryBuilder<Employee> = createQueryBuilder(new MockAdapter<Employee>())
annotated = annotated.where('active', '=', true)
const grouped: QueryBuilder<Employee> = annotated.groupBy('role')
grouped.having('n', '>', 0).agg({ n: 'count', total: 'sum:salary' })
annotated.clone().sum('salary')

// The bare AggSpec accepts any field name, so existing annotations compile
const looseSpec: AggSpec = 'sum:anything'
const looseSpecs: Record<string, AggSpec> = { n: 'count', s: 'max:whatever' }
const narrowSpec: AggSpec<'salary'> = 'avg:salary'
// @ts-expect-error a narrowed AggSpec checks the field
const badNarrowSpec: AggSpec<'salary'> = 'avg:name'

// website/docs/aggregation.md
const db = defineSheetsDB({
  tables: {
    orders: {
      columns: ['id', 'product', 'category', 'amount', 'quantity', 'region'] as const,
      types: { id: 0, product: '', category: '', amount: 0, quantity: 0, region: '' }
    }
  },
  mock: true
})
const orders = db.from('orders')

orders.query().sum('amount')
orders.query().avg('amount')
orders.query().min('amount')
orders.query().max('amount')
orders.query().count()
orders.query().where('region', '=', 'US').sum('amount')

orders.query().agg({
  totalAmount: 'sum:amount',
  avgAmount:   'avg:amount',
  minAmount:   'min:amount',
  maxAmount:   'max:amount',
  orderCount:  'count'
})

const byCategoryAndRegion = orders.query()
  .groupBy('category', 'region')
  .agg({ totalAmount: 'sum:amount', orderCount: 'count' })
const _region: unknown = byCategoryAndRegion[0].region

const report = orders.query()
  .where('region', '=', 'US')
  .groupBy('category')
  .having('orderCount', '>=', 2)
  .having('revenue', '>', 100)
  .agg({
    revenue:    'sum:amount',
    avgOrder:   'avg:amount',
    orderCount: 'count'
  })
const _category: unknown = report[0].category
const _revenue: number = report[0].revenue
// @ts-expect-error region is not a group key here
report[0].region

// @ts-expect-error product is a string column
orders.query().agg({ total: 'sum:product' })

export {
  _sum, _avg, _min, _max, _role, _total, _region, _category, _revenue,
  looseSpec, looseSpecs, narrowSpec, badNarrowSpec
}
