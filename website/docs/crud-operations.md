# CRUD Operations

All CRUD operations are accessed through a `TableHandle`, returned by `db.from('tableName')`.

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true }
    }
  },
  mock: true
})

const users = db.from('users')
```

## Create

Insert a new row. The `id` field is auto-generated (in auto mode).

```ts
const user = users.create({ name: 'Alice', email: 'alice@example.com', age: 30, active: true })
// { id: 1, name: 'Alice', email: 'alice@example.com', age: 30, active: true }
```

## Read

### findById (throwing)

Returns the row or throws `RowNotFoundError`.

```ts
const user = users.findById(1)
// { id: 1, name: 'Alice', ... }

users.findById(999) // throws RowNotFoundError
```

### findByIdOrNull (nullable)

Returns the row or `undefined` if not found.

```ts
const user = users.repo.findByIdOrNull(1)
// { id: 1, name: 'Alice', ... } or undefined
```

### findAll

Returns all rows in the table.

```ts
const allUsers = users.findAll()
// [{ id: 1, ... }, { id: 2, ... }]
```

### Querying

For filtered, sorted, or paginated reads, use the [Query Builder](./query-builder.md):

```ts
const activeUsers = users.query()
  .where('active', '=', true)
  .orderBy('name')
  .exec()
```

## Update

### update (throwing)

Updates a row by ID. Returns the updated row or throws `RowNotFoundError`.

```ts
const updated = users.update(1, { age: 31 })
// { id: 1, name: 'Alice', age: 31, ... }

users.update(999, { age: 0 }) // throws RowNotFoundError
```

### updateOrNull (nullable)

Returns the updated row or `undefined` if not found.

```ts
const updated = users.repo.updateOrNull(1, { age: 31 })
// { id: 1, name: 'Alice', age: 31, ... } or undefined
```

## Delete

### delete (throwing)

Deletes a row by ID. Throws `RowNotFoundError` if not found.

```ts
users.delete(1)

users.delete(999) // throws RowNotFoundError
```

### deleteIfExists (nullable)

Returns `true` if deleted, `false` if not found.

```ts
const deleted = users.repo.deleteIfExists(1) // true
const notFound = users.repo.deleteIfExists(999) // false
```

## Utility Methods

### count

Count all rows in the table.

```ts
const total = users.repo.count() // 5
```

### exists

Check if a row exists by ID.

```ts
const found = users.repo.exists(1) // true
const missing = users.repo.exists(999) // false
```

## Throwing vs Nullable Variants

| Operation | Throwing (default) | Nullable |
|-----------|-------------------|----------|
| Find by ID | `findById(id)` | `repo.findByIdOrNull(id)` |
| Update | `update(id, data)` | `repo.updateOrNull(id, data)` |
| Delete | `delete(id)` | `repo.deleteIfExists(id)` |

The **throwing** variants are available directly on `TableHandle` (via `db.from('users')`).
The **nullable** variants are on the `repo` property.

```ts
// Throwing - use when the row should exist
const user = users.findById(1)

// Nullable - use when you want to handle missing rows yourself
const user = users.repo.findByIdOrNull(1)
if (!user) {
  console.log('User not found')
}
```

---

## See Also

- [Query Builder](./query-builder.md) -- Filtered reads with where, orderBy, limit
- [Batch Operations](./batch-operations.md) -- Bulk insert and update
- [Error Handling](./error-handling.md) -- RowNotFoundError and other errors
