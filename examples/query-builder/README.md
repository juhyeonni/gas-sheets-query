# Query Builder Example

Various query examples using gas-sheets-query QueryBuilder.

## Run

```bash
npx tsx examples/query-builder/index.ts
```

## Key Concepts

### 1. WHERE Conditions

```typescript
// Equals
products.query().where('category', '=', 'Electronics')

// Comparison
products.query().where('price', '>=', 100)

// IN
products.query().where('category', 'in', ['Clothing', 'Footwear'])

// LIKE
products.query().where('name', 'like', 'S%')
```

### 2. Multiple Conditions (AND)

```typescript
products.query()
  .where('active', '=', true)
  .where('price', '>', 50)
  .exec()
```

### 3. Sorting

```typescript
// Single sort
products.query().orderBy('price', 'desc')

// Multiple sort
products.query()
  .orderBy('category', 'asc')
  .orderBy('price', 'desc')
```

### 4. Pagination

```typescript
// limit/offset
products.query().limit(10).offset(20)

// page method
products.query().page(2, 10)  // Page 2, 10 items per page
```

### 5. Result Methods

```typescript
query.exec()      // All results
query.first()     // First result
query.count()     // Count
query.exists()    // Check existence
```

### 6. Aggregation

```typescript
// Single aggregation
query.sum('amount')
query.avg('price')
query.min('price')
query.max('price')

// Group by aggregation
products.query()
  .groupBy('category')
  .agg({
    count: 'count',
    totalStock: 'sum:stock',
    avgPrice: 'avg:price'
  })
```

## Example Output

```
=== WHERE Conditions ===
Electronics: Laptop, Keyboard, Mouse
Not cancelled orders: 7
Price >= 100: Laptop, Keyboard, Sneakers

=== Aggregation ===
Total revenue (PAID): 4075
Average order amount: 558.13
Price range: 25 ~ 1200

=== GROUP BY ===
Category Stats:
  Electronics:
    - Products: 3
    - Total Stock: 550
    - Avg Price: $450.00
    ...
```
