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

Same API as QueryBuilder:

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
.clone()         // JoinQueryBuilder<T>
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

### Aggregation Specs

```ts
type AggSpec =
  | 'count'            // count rows in group
  | `sum:${string}`    // sum of field
  | `avg:${string}`    // average of field
  | `min:${string}`    // minimum of field
  | `max:${string}`    // maximum of field
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
// Result: { category: string; count: number; totalAmount: number; avgAmount: number; maxAmount: number }[]
```

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

### Multi-field GroupBy

```ts
const byRegionAndCategory = db.from('orders').query()
  .groupBy('region', 'category')
  .agg({
    count: 'count',
    total: 'sum:amount',
  })
// Result: { region: string; category: string; count: number; total: number }[]
```

## Anti-Patterns

```ts
// WRONG: calling agg() without groupBy — agg requires grouped data
db.from('orders').query().agg({ count: 'count' })
// RIGHT: use single-value aggregation methods for ungrouped
db.from('orders').query().sum('amount')

// WRONG: having() without matching agg name
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
