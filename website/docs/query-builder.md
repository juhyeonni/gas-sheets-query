# Query Builder

The `QueryBuilder` provides a fluent API for filtering, sorting, paginating, and aggregating data.

## Getting a QueryBuilder

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'department', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, department: '', active: true }
    }
  },
  mock: true
})

const query = db.from('users').query()
```

## Where Conditions

All `where` calls are combined with AND logic.

### Operators

```ts
query.where('age', '=', 25)       // equals
query.where('age', '!=', 25)      // not equals
query.where('age', '>', 18)       // greater than
query.where('age', '>=', 18)      // greater or equal
query.where('age', '<', 65)       // less than
query.where('age', '<=', 65)      // less or equal
query.where('name', 'like', '%li%')  // pattern match
query.where('department', 'in', ['engineering', 'design'])  // in list
```

### Shorthand Methods

```ts
query.whereEq('name', 'Alice')                   // where('name', '=', 'Alice')
query.whereNot('active', false)                   // where('active', '!=', false)
query.whereIn('department', ['eng', 'design'])    // where('department', 'in', [...])
query.whereLike('email', '%@example.com')         // where('email', 'like', '...')
```

### LIKE Patterns

| Pattern | Matches |
|---------|---------|
| `'%alice%'` | Contains "alice" |
| `'alice%'` | Starts with "alice" |
| `'%@example.com'` | Ends with "@example.com" |

### Combining Conditions

Multiple `where` calls create AND conditions:

```ts
const results = db.from('users').query()
  .where('active', '=', true)
  .where('age', '>=', 18)
  .where('department', '=', 'engineering')
  .exec()
```

## Sorting

```ts
// Single sort
query.orderBy('name', 'asc')

// Multiple sort (primary then secondary)
query.orderBy('department', 'asc').orderBy('name', 'desc')

// Default direction is 'asc'
query.orderBy('name') // ascending
```

## Pagination

### limit / offset

```ts
// First 10 results
query.limit(10).exec()

// Skip 20, take 10
query.offset(20).limit(10).exec()
```

### page (shorthand)

```ts
// Page 1 with 10 items per page
query.page(1, 10).exec()

// Page 3 with 25 items per page
query.page(3, 25).exec()
```

> `page(n, size)` is equivalent to `offset((n - 1) * size).limit(size)`.

## Execution Methods

### exec()

Returns all matching rows as an array.

```ts
const users = query.where('active', '=', true).exec()
// User[]
```

### first()

Returns the first matching row or `undefined`.

```ts
const user = query.where('email', '=', 'alice@example.com').first()
// User | undefined
```

### firstOrFail()

Returns the first matching row or throws `NoResultsError`.

```ts
const user = query.where('email', '=', 'alice@example.com').firstOrFail()
// User (throws if not found)
```

### count()

Returns the count of matching rows (ignores limit/offset).

```ts
const total = query.where('active', '=', true).count()
// number
```

### exists()

Returns `true` if any rows match.

```ts
const hasActive = query.where('active', '=', true).exists()
// boolean
```

## Aggregation Methods

Direct aggregation without `groupBy`:

```ts
const totalAge = query.sum('age')         // number (0 if empty)
const avgAge   = query.avg('age')         // number | null
const youngest = query.min('age')         // number | null
const oldest   = query.max('age')         // number | null
```

For grouped aggregations, see [Aggregation](./aggregation.md).

## Cloning

Create a copy of a query builder to reuse common conditions:

```ts
const baseQuery = db.from('users').query()
  .where('active', '=', true)

const engineers = baseQuery.clone()
  .where('department', '=', 'engineering')
  .exec()

const designers = baseQuery.clone()
  .where('department', '=', 'design')
  .exec()
```

## Build Without Executing

Inspect the query options without running them:

```ts
const options = query
  .where('active', '=', true)
  .orderBy('name')
  .limit(10)
  .build()

// { where: [...], orderBy: [...], limitValue: 10, offsetValue: undefined }
```

## Full Example

```ts
const db = defineSheetsDB({
  tables: {
    products: {
      columns: ['id', 'name', 'category', 'price', 'inStock'] as const,
      types: { id: 0, name: '', category: '', price: 0, inStock: true }
    }
  },
  mock: true
})

// Seed data
const products = db.from('products')
products.batchInsert([
  { name: 'Widget A', category: 'widgets', price: 9.99, inStock: true },
  { name: 'Widget B', category: 'widgets', price: 19.99, inStock: false },
  { name: 'Gadget X', category: 'gadgets', price: 49.99, inStock: true },
  { name: 'Gadget Y', category: 'gadgets', price: 29.99, inStock: true },
])

// Find affordable in-stock widgets
const results = products.query()
  .where('category', '=', 'widgets')
  .where('inStock', '=', true)
  .where('price', '<', 20)
  .orderBy('price', 'asc')
  .exec()
// [{ id: 1, name: 'Widget A', ... }]

// Count all gadgets
const gadgetCount = products.query()
  .where('category', '=', 'gadgets')
  .count()
// 2

// Average price of in-stock items
const avgPrice = products.query()
  .where('inStock', '=', true)
  .avg('price')
// 29.99
```

---

## See Also

- [CRUD Operations](./crud-operations.md) -- Basic create, read, update, delete
- [Aggregation](./aggregation.md) -- groupBy, having, and agg specs
- [JOIN Queries](./join-queries.md) -- Querying across multiple tables
