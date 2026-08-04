# Aggregation

The QueryBuilder supports SQL-like aggregation: `sum`, `avg`, `min`, `max`, `count`, `groupBy`, and `having`.

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

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
orders.batchInsert([
  { product: 'Widget',  category: 'A', amount: 100, quantity: 5,  region: 'US' },
  { product: 'Gadget',  category: 'A', amount: 200, quantity: 3,  region: 'EU' },
  { product: 'Gizmo',   category: 'B', amount: 150, quantity: 7,  region: 'US' },
  { product: 'Doodad',  category: 'B', amount: 50,  quantity: 10, region: 'EU' },
  { product: 'Thingee', category: 'A', amount: 300, quantity: 2,  region: 'US' },
])
```

## Simple Aggregations

Direct methods on the QueryBuilder (no grouping):

```ts
const total    = orders.query().sum('amount')    // 800
const average  = orders.query().avg('amount')    // 160
const cheapest = orders.query().min('amount')    // 50
const priciest = orders.query().max('amount')    // 300
const count    = orders.query().count()          // 5
```

### With Filters

```ts
const usTotal = orders.query()
  .where('region', '=', 'US')
  .sum('amount')
// 550
```

### Return Values

| Method | Empty dataset | No numeric values |
|--------|--------------|-------------------|
| `sum()` | `0` | `0` |
| `avg()` | `null` | `null` |
| `min()` | `null` | `null` |
| `max()` | `null` | `null` |
| `count()` | `0` | `0` |

> **Note:** These values apply to the direct `sum()`/`avg()`/`min()`/`max()`/`count()` methods. The `agg()` spec form (below) instead returns `0` -- not `null` -- for `avg`/`min`/`max` when a group has no numeric values.

## Agg Specs

For multiple aggregations in a single pass, use `agg()` with aggregation specs:

```ts
const result = orders.query().agg({
  totalAmount: 'sum:amount',
  avgAmount:   'avg:amount',
  minAmount:   'min:amount',
  maxAmount:   'max:amount',
  orderCount:  'count'
})

// [{ totalAmount: 800, avgAmount: 160, minAmount: 50, maxAmount: 300, orderCount: 5 }]
```

### AggSpec Format

| Spec | Description |
|------|-------------|
| `'count'` | Count of rows |
| `'sum:fieldName'` | Sum of field values |
| `'avg:fieldName'` | Average of field values |
| `'min:fieldName'` | Minimum field value |
| `'max:fieldName'` | Maximum field value |

## GroupBy

Group results by one or more fields:

```ts
const byCategory = orders.query()
  .groupBy('category')
  .agg({
    totalAmount: 'sum:amount',
    orderCount:  'count'
  })

// [
//   { category: 'A', totalAmount: 600, orderCount: 3 },
//   { category: 'B', totalAmount: 200, orderCount: 2 }
// ]
```

### Multiple Group Fields

```ts
const byCategoryAndRegion = orders.query()
  .groupBy('category', 'region')
  .agg({
    totalAmount: 'sum:amount',
    orderCount:  'count'
  })

// [
//   { category: 'A', region: 'US', totalAmount: 400, orderCount: 2 },
//   { category: 'A', region: 'EU', totalAmount: 200, orderCount: 1 },
//   { category: 'B', region: 'US', totalAmount: 150, orderCount: 1 },
//   { category: 'B', region: 'EU', totalAmount: 50,  orderCount: 1 }
// ]
```

## Having

Filter groups by aggregation conditions (applied after grouping):

```ts
const bigCategories = orders.query()
  .groupBy('category')
  .having('orderCount', '>=', 3)
  .agg({
    totalAmount: 'sum:amount',
    orderCount:  'count'
  })

// [{ category: 'A', totalAmount: 600, orderCount: 3 }]
```

### Multiple Having Conditions

```ts
const results = orders.query()
  .groupBy('category')
  .having('orderCount', '>=', 2)
  .having('totalAmount', '>', 100)
  .agg({
    totalAmount: 'sum:amount',
    orderCount:  'count'
  })
```

## With Filters + GroupBy

Combine `where` with `groupBy`:

```ts
const usRegionByCategory = orders.query()
  .where('region', '=', 'US')
  .groupBy('category')
  .agg({
    totalAmount: 'sum:amount',
    orderCount:  'count'
  })

// [
//   { category: 'A', totalAmount: 400, orderCount: 2 },
//   { category: 'B', totalAmount: 150, orderCount: 1 }
// ]
```

## Full Example

```ts
// Revenue report: top categories in the US with 2+ orders
const report = orders.query()
  .where('region', '=', 'US')
  .groupBy('category')
  .having('orderCount', '>=', 2)
  .agg({
    revenue:    'sum:amount',
    avgOrder:   'avg:amount',
    orderCount: 'count'
  })
```

---

## See Also

- [Query Builder](./query-builder.md) -- Where conditions, sorting, pagination
- [CRUD Operations](./crud-operations.md) -- Basic data operations
- [Batch Operations](./batch-operations.md) -- Bulk data operations
