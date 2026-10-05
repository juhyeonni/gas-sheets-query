# gsquery — Joins & Aggregation

## JoinQueryBuilder

Access via `db.from('table').joinQuery()`. Batch-fetches joined data (no N+1).

```ts
const results = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
  .innerJoin('categories', 'categoryId', 'id')
  .where('published', '=', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .exec()

// Result shape:
// { id, title, authorId, categoryId, published,
//   author: { id, name, email } | null,       // null for unmatched left joins
//   categories: { id, name } }                 // innerJoin excludes unmatched
```

### Join Methods

```ts
// Generic join
.join(table, localField, foreignField?, { as?, type?: 'left' | 'inner' })

// Shorthand
.leftJoin(table, localField, foreignField?, { as? })    // include unmatched (null)
.innerJoin(table, localField, foreignField?, { as? })   // exclude unmatched
```

- `foreignField` defaults to `'id'`
- `as` defaults to table name

### Where

`where()` filters the main table only. The field is a main-table key, bare or as `<mainTable>.<key>`, and the value is typed by that key:

```ts
db.from('posts').joinQuery().where('published', '=', true)        // OK
db.from('posts').joinQuery().where('posts.published', '=', true)  // OK: same filter
db.from('posts').joinQuery().where('users.name', '=', 'Alice')    // compile error: not the main table
```
- All joined tables must be registered in `defineSheetsDB`

### Execution

Same as QueryBuilder: `.exec()`, `.first()`, `.firstOrFail()`, `.count()`, `.exists()`

---

## Grouped Aggregation

### AggSpec Format

```ts
type AggSpec<F extends string = string> = 'count' | `sum:${F}` | `avg:${F}` | `min:${F}` | `max:${F}`
```

In `agg()`, the field must be a numeric column (`number`, `number | null`, optional `number`); `sum()`/`avg()`/`min()`/`max()` take the same columns. `'sum:status'` on a string column, or `'sum:amout'` with a typo, does not compile.

### Single-Value (no groupBy)

```ts
db.from('orders').query()
  .where('status', '=', 'completed')
  .sum('amount')   // number
```

### Grouped

```ts
const stats = db.from('orders').query()
  .groupBy('category')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgPrice: 'avg:price',
  })
// [{ category: 'Electronics', count: 15, totalAmount: 5000, avgPrice: 333.3 }, ...]
```

### With Having

```ts
db.from('orders').query()
  .groupBy('category')
  .having('totalAmount', '>', 1000)
  .agg({ count: 'count', totalAmount: 'sum:amount' })
// Only groups where totalAmount > 1000
```

### Multi-Field GroupBy

```ts
db.from('orders').query()
  .groupBy('region', 'category')
  .agg({ count: 'count', total: 'sum:amount' })
// [{ region: 'US', category: 'Tech', count: 5, total: 2500 }, ...]
```

## Common Mistakes

- Join results are nested objects (`result.author.name`), not flat (`result.authorName`)
- `having()` aggName must match a key in the `agg()` specs, or `agg()` throws a `SheetsQueryError` (code `UNKNOWN_AGGREGATION`)
- `agg()` results have the `groupBy()` keys (typed `unknown`) and the spec names only; without `groupBy()`, one row with the spec names
- All joined tables must exist in your `defineSheetsDB` config
