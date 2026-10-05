# Joins & Aggregation Reference

## JoinQueryBuilder

Access via `db.from('table').joinQuery()`. Supports LEFT and INNER joins with batch fetching to prevent N+1 queries.

### Join Methods

```ts
const results = db.from('posts').joinQuery()
  // join(table, localField, foreignField?, options?)
  .join('users', 'authorId', 'id', { as: 'author', type: 'left' })
  // Shorthand methods:
  .leftJoin('categories', 'categoryId', 'id', { as: 'category' })
  .innerJoin('tags', 'tagId', 'id')
  .exec()
```

**Parameters**:
- `table`: name of the foreign table (must exist in SheetsDB)
- `localField`: field on the current table containing the foreign key
- `foreignField`: field on the foreign table to match (default: `'id'`)
- `options.as`: alias for the joined data in results (default: table name)
- `options.type`: `'left'` (include unmatched) or `'inner'` (exclude unmatched)

### Join Result Shape

```ts
// leftJoin: joined object or null
{ id: 1, title: 'Post', authorId: 1, author: { id: 1, name: 'Alice' } }
{ id: 2, title: 'Orphan', authorId: 999, author: null }  // left join

// innerJoin: only rows with matches
{ id: 1, title: 'Post', categoryId: 1, categories: { id: 1, name: 'Tech' } }
```

### Full Example

```ts
const db = defineSheetsDB({
  tables: {
    orders: {
      columns: ['id', 'productId', 'customerId', 'amount', 'status'] as const,
      types: { id: 0, productId: 0, customerId: 0, amount: 0, status: '' },
    },
    products: {
      columns: ['id', 'name', 'price', 'category'] as const,
      types: { id: 0, name: '', price: 0, category: '' },
    },
    customers: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' },
    },
  },
  mock: true,
})

const orderDetails = db.from('orders').joinQuery()
  .leftJoin('products', 'productId', 'id', { as: 'product' })
  .leftJoin('customers', 'customerId', 'id', { as: 'customer' })
  .where('status', '=', 'completed')
  .orderBy('amount', 'desc')
  .limit(10)
  .exec()

// Result: { id, productId, customerId, amount, status, product: {...}, customer: {...} }[]
```

### Where/Sort/Pagination in JoinQueryBuilder

`where()` filters the main table only. The field is a main-table key, bare or as `<mainTable>.<key>`, and the value is typed by that key:

```ts
const posts = db.from('posts').joinQuery()   // JoinQueryBuilder<Post, 'posts'>
posts.where('status', '=', 'published')        // OK
posts.where('posts.status', '=', 'published')  // OK: same filter
posts.where('posts.status', '=', 1)            // compile error: string column
posts.where('nope', '=', 'x')                  // compile error: unknown key
posts.where('users.name', '=', 'Alice')        // compile error: not the main table
```

A builder annotated `JoinQueryBuilder<Post>` (no table name) accepts any prefix before a valid key at compile time; a prefix other than the main table's name throws at runtime.

The rest is the same API as QueryBuilder:

```ts
.where(field, operator, value)
.whereEq(field, value)
.whereNot(field, value)
.whereIn(field, values)
.whereLike(field, pattern)
.orderBy(field, direction?)
.limit(count)
.offset(count)
.page(pageNumber, pageSize)
```

### Execution Methods

```ts
.exec()          // (T & Record<string, unknown>)[]
.first()         // (T & Record<string, unknown>) | undefined
.firstOrFail()   // throws NoResultsError
.count()         // number
.exists()        // boolean
.build()         // QueryOptions<T>
.clone()         // JoinQueryBuilder<T, TName>
```

### JoinConfig Type

```ts
interface JoinConfig {
  table: string
  localField: string
  foreignField: string
  as?: string
  type: 'left' | 'inner'
}
```

---

## Grouped Aggregation

Use `groupBy()` + `agg()` on a QueryBuilder.

Groups are returned in the order their first row appears in the query result, so `.orderBy(field)` before `.groupBy()` controls group order. `count()`, `sum()`, `avg()`, `min()`, `max()` and `agg()` without `groupBy()` ignore `orderBy` and do not sort.

### Aggregation Specs

```ts
type AggSpec<F extends string = string> =
  | 'count'       // count rows in group
  | `sum:${F}`    // sum of field
  | `avg:${F}`    // average of field
  | `min:${F}`    // minimum of field
  | `max:${F}`    // maximum of field
```

In `agg()`, `F` is `NumericColumn<T>`: the columns whose type can hold a number (`number`, `number | null`, optional `number`). `sum()`/`avg()`/`min()`/`max()` take the same columns. An unknown or string-only column always aggregates to 0 or null, so it does not compile:

```ts
q.agg({ total: 'sum:amount' })     // OK
q.agg({ total: 'sum:amout' })      // compile error: unknown column
q.agg({ total: 'sum:status' })     // compile error: string column
q.sum('status')                    // compile error: string column
```

### Basic Aggregation

```ts
// Single-value aggregation (no groupBy)
db.from('orders').query()
  .where('status', '=', 'completed')
  .sum('amount')   // number
  .avg('amount')   // number | null
  .min('amount')   // number | null
  .max('amount')   // number | null
```

### Grouped Aggregation

```ts
const stats = db.from('orders').query()
  .where('status', '=', 'completed')
  .groupBy('category')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgAmount: 'avg:amount',
    maxAmount: 'max:amount',
  })
// Result: { category: unknown; count: number; totalAmount: number; avgAmount: number; maxAmount: number }[]
```

The result type has the `groupBy()` keys (values typed `unknown`) and the spec names only: `stats[0].status` does not compile. Without `groupBy()`, `agg()` returns one row with only the spec names. A second `groupBy()` call replaces the keys.

### Grouped Aggregation with Having

```ts
const topCategories = db.from('orders').query()
  .groupBy('category')
  .having('totalAmount', '>', 1000)
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
  })
// Only groups where totalAmount > 1000
```

Each `having()` alias must be an `agg()` spec name. Otherwise `agg()` throws a `SheetsQueryError` (code `UNKNOWN_AGGREGATION`) naming the alias, before reading rows, with or without `groupBy()`. Without `groupBy()`, a valid `having()` is ignored.

### Multi-field GroupBy

```ts
const byRegionAndCategory = db.from('orders').query()
  .groupBy('region', 'category')
  .agg({
    count: 'count',
    total: 'sum:amount',
  })
// Result: { region: unknown; category: unknown; count: number; total: number }[]
```

## Anti-Patterns

```ts
// WRONG: aggregating a string column — does not compile (it would always be 0)
db.from('orders').query().agg({ total: 'sum:status' })
// RIGHT: aggregate a numeric column
db.from('orders').query().agg({ total: 'sum:amount' })

// WRONG: prefixing a joined table's field in where() — does not compile
db.from('posts').joinQuery().join('users', 'authorId').where('users.name', '=', 'Alice')
// RIGHT: filter the main table in where(), joined data after exec()

// WRONG: having() without matching agg name — agg() throws SheetsQueryError
.groupBy('cat').having('total', '>', 100).agg({ count: 'count' })
// RIGHT: having aggName must match an agg key
.groupBy('cat').having('total', '>', 100).agg({ total: 'sum:amount' })

// WRONG: joining a table not registered in defineSheetsDB
db.from('posts').joinQuery().join('unknownTable', 'fk', 'id')
// RIGHT: all joined tables must be defined in the tables config

// WRONG: expecting join results to be flat
result.authorName  // undefined — joined data is nested
// RIGHT:
result.author.name  // correct — use the alias/table name
```
