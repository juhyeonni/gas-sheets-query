# Examples

A collection of practical examples for gas-sheets-query.

## Table of Contents

- [Basic CRUD](#basic-crud)
- [Query Builder](#query-builder)
- [JOIN](#join)
- [Aggregation](#aggregation)
- [Migration](#migration)
- [Practical Patterns](#practical-patterns)

---

## Basic CRUD

### Initial Setup

```typescript
import { defineSheetsDB, MockAdapter } from '@gsquery/core'

// Type definition
interface User {
  id: number
  name: string
  email: string
  role: 'USER' | 'ADMIN'
  active: boolean
  createdAt: Date
}

// DB initialization
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role', 'active', 'createdAt'] as const,
      types: {
        id: 0,
        name: '',
        email: '',
        role: 'USER' as const,
        active: true,
        createdAt: new Date()
      }
    }
  },
  stores: {
    users: new MockAdapter<User>()
  }
})

const users = db.from('users')
```

### Create

```typescript
// Single create
const user = users.create({
  name: 'John Doe',
  email: 'john@example.com',
  role: 'USER',
  active: true,
  createdAt: new Date()
})
console.log(user.id)  // Auto-generated ID

// Batch create
const newUsers = users.batchInsert([
  { name: 'Alice', email: 'alice@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Bob', email: 'bob@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Carol', email: 'carol@example.com', role: 'ADMIN', active: true, createdAt: new Date() }
])
```

### Read

```typescript
// Find by ID
const user = users.findById(1)

// Get all
const allUsers = users.findAll()

// Query
const activeUsers = users.query()
  .where('active', '=', true)
  .exec()
```

### Update

```typescript
// Single update
users.update(1, { name: 'John Smith' })

// Batch update
users.batchUpdate([
  { id: 1, data: { role: 'ADMIN' } },
  { id: 2, data: { active: false } }
])
```

### Delete

```typescript
// Single delete
users.delete(1)

// Conditional delete (manual implementation)
const inactiveUsers = users.query().where('active', '=', false).exec()
for (const user of inactiveUsers) {
  users.delete(user.id)
}
```

---

## Query Builder

### Basic Conditions

```typescript
// Equal
users.query().where('role', '=', 'ADMIN').exec()

// Not equal
users.query().where('role', '!=', 'USER').exec()

// Comparison
users.query().where('age', '>', 18).exec()
users.query().where('age', '>=', 21).exec()
users.query().where('age', '<', 65).exec()
users.query().where('age', '<=', 30).exec()

// IN
users.query().where('role', 'in', ['ADMIN', 'MODERATOR']).exec()

// LIKE (pattern matching)
users.query().where('name', 'like', 'John%').exec()   // Starts with
users.query().where('email', 'like', '%@gmail.com').exec()  // Ends with
users.query().where('name', 'like', '%son%').exec()   // Contains
```

### Multiple Conditions (AND)

```typescript
// All conditions must match
const result = users.query()
  .where('active', '=', true)
  .where('role', '=', 'ADMIN')
  .where('age', '>', 25)
  .exec()
```

### Sorting

```typescript
// Single sort
users.query()
  .orderBy('name', 'asc')
  .exec()

// Multiple sort
users.query()
  .orderBy('role', 'asc')
  .orderBy('name', 'asc')
  .exec()
```

### Pagination

```typescript
// limit/offset
const first10 = users.query().limit(10).exec()
const next10 = users.query().offset(10).limit(10).exec()

// page method (convenience)
const page1 = users.query().page(1, 10).exec()  // Page 1
const page2 = users.query().page(2, 10).exec()  // Page 2

// Pagination helper
function paginate(query, pageNum, pageSize) {
  const total = query.clone().count()
  const data = query.page(pageNum, pageSize).exec()
  
  return {
    data,
    pagination: {
      page: pageNum,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  }
}
```

### Result Handling

```typescript
// First result
const first = users.query()
  .where('email', '=', 'john@example.com')
  .first()

if (first) {
  console.log('Found:', first.name)
}

// First result (throws if not found)
try {
  const user = users.query()
    .where('email', '=', 'notfound@example.com')
    .firstOrFail()
} catch (error) {
  console.log('User not found')
}

// Existence check
const exists = users.query()
  .where('email', '=', 'john@example.com')
  .exists()

// Count
const count = users.query()
  .where('active', '=', true)
  .count()
```

### Convenience Methods

```typescript
// whereEq (=)
users.query().whereEq('role', 'ADMIN')

// whereNot (!=)
users.query().whereNot('status', 'DELETED')

// whereIn
users.query().whereIn('role', ['ADMIN', 'MODERATOR'])

// whereLike
users.query().whereLike('name', 'John%')
```

---

## JOIN

### Basic JOIN

```typescript
// Posts + Author
const posts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id')
  .exec()

// Result: [
//   { id: 1, title: '...', authorId: 1, users: { id: 1, name: 'John', ... } }
// ]
```

### Using Aliases

```typescript
const posts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// Result: [
//   { id: 1, title: '...', author: { id: 1, name: 'John', ... } }
// ]
```

### Multiple JOINs

```typescript
// Comments + Post + Author
const comments = db.from('comments')
  .joinQuery()
  .join('posts', 'postId', 'id', { as: 'post' })
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// Result: [
//   { 
//     id: 1, 
//     content: '...', 
//     post: { id: 1, title: '...' },
//     author: { id: 1, name: 'John' }
//   }
// ]
```

### Inner JOIN

```typescript
// Return only matching records
const postsWithAuthors = db.from('posts')
  .joinQuery()
  .innerJoin('users', 'authorId', 'id', { as: 'author' })
  .exec()
```

### JOIN + Conditions/Sorting

```typescript
const recentPosts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .exec()
```

---

## Aggregation

### Basic Aggregation

```typescript
// Count
const userCount = db.from('users').query().count()

// Sum
const totalRevenue = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .sum('amount')

// Average
const avgOrderAmount = db.from('orders')
  .query()
  .avg('amount')

// Min/Max
const minPrice = db.from('products').query().min('price')
const maxPrice = db.from('products').query().max('price')
```

### Group Aggregation

```typescript
// Statistics by category
const categoryStats = db.from('products')
  .query()
  .groupBy('category')
  .agg({
    productCount: 'count',
    totalStock: 'sum:stock',
    avgPrice: 'avg:price',
    minPrice: 'min:price',
    maxPrice: 'max:price'
  })

// Result: [
//   { category: 'Electronics', productCount: 50, totalStock: 1000, avgPrice: 500, ... },
//   { category: 'Clothing', productCount: 100, totalStock: 5000, avgPrice: 50, ... }
// ]
```

### Multiple Groups

```typescript
// Revenue by year-month
const monthlyRevenue = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .groupBy('year', 'month')
  .agg({
    orderCount: 'count',
    revenue: 'sum:amount',
    avgOrder: 'avg:amount'
  })
```

### Having (Group Filter)

```typescript
// Only categories with more than 10 orders
const popularCategories = db.from('products')
  .query()
  .groupBy('category')
  .having('orderCount', '>', 10)
  .agg({
    orderCount: 'count',
    revenue: 'sum:amount'
  })
```

---

## Migration

### Migration File

```typescript
// migrations/001_initial.ts
import type { Migration } from '@gsquery/core'

export const migration: Migration = {
  version: 1,
  name: 'initial_schema',
  
  up: (db) => {
    // Add new columns
    db.addColumn('users', 'nickname', { default: '' })
    db.addColumn('users', 'bio', { default: '' })
  },
  
  down: (db) => {
    // Remove columns
    db.removeColumn('users', 'nickname')
    db.removeColumn('users', 'bio')
  }
}
```

### Rename Column

```typescript
// migrations/002_rename_column.ts
export const migration: Migration = {
  version: 2,
  name: 'rename_nickname_to_displayName',
  
  up: (db) => {
    db.renameColumn('users', 'nickname', 'displayName')
  },
  
  down: (db) => {
    db.renameColumn('users', 'displayName', 'nickname')
  }
}
```

### Running Migrations

```typescript
import { createMigrationRunner, MockAdapter } from '@gsquery/core'
import { migration as m1 } from './migrations/001_initial'
import { migration as m2 } from './migrations/002_rename_column'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),
  storeResolver: (table) => stores[table],
  migrations: [m1, m2]
})

// Check status
console.log('Current version:', runner.getCurrentVersion())
console.log('Pending:', runner.getPendingMigrations())

// Run
const result = await runner.migrate()
console.log('Applied:', result.applied)

// Rollback
const rollback = await runner.rollback()
console.log('Rolled back:', rollback.rolledBack)
```

---

## Practical Patterns

### Repository Pattern

```typescript
class UserRepository {
  constructor(private db: SheetsDB) {}
  
  findByEmail(email: string) {
    return this.db.from('users')
      .query()
      .whereEq('email', email)
      .first()
  }
  
  findActiveAdmins() {
    return this.db.from('users')
      .query()
      .whereEq('role', 'ADMIN')
      .whereEq('active', true)
      .orderBy('name', 'asc')
      .exec()
  }
  
  search(query: string, page: number, pageSize: number) {
    const baseQuery = this.db.from('users')
      .query()
      .whereLike('name', `%${query}%`)
    
    return {
      data: baseQuery.clone().page(page, pageSize).exec(),
      total: baseQuery.count()
    }
  }
}
```

### Transaction Pattern

```typescript
// Pseudo-transaction (no rollback support)
async function createOrderWithItems(order: Order, items: OrderItem[]) {
  // 1. Create order
  const created = db.from('orders').create(order)
  
  try {
    // 2. Create order items
    const orderItems = items.map(item => ({
      ...item,
      orderId: created.id
    }))
    db.from('orderItems').batchInsert(orderItems)
    
    // 3. Update stock
    for (const item of items) {
      const product = db.from('products').findById(item.productId)
      db.from('products').update(item.productId, {
        stock: product.stock - item.quantity
      })
    }
    
    return created
  } catch (error) {
    // Delete order on failure
    db.from('orders').delete(created.id)
    throw error
  }
}
```

### Soft Delete

```typescript
// Using deletedAt column
class SoftDeleteRepository<T extends { id: number; deletedAt: Date | null }> {
  constructor(
    private table: TableHandle<T>
  ) {}
  
  findAll() {
    return this.table.query()
      .where('deletedAt', '=', null)
      .exec()
  }
  
  delete(id: number) {
    this.table.update(id, { deletedAt: new Date() } as Partial<T>)
  }
  
  restore(id: number) {
    this.table.update(id, { deletedAt: null } as Partial<T>)
  }
  
  forceDelete(id: number) {
    this.table.delete(id)
  }
  
  findWithDeleted() {
    return this.table.findAll()
  }
}
```

### Audit Log

```typescript
function createAuditedTable<T extends { id: number }>(table: TableHandle<T>) {
  const auditLogs = db.from('auditLogs')
  
  return {
    create(data: Omit<T, 'id'>, userId: number) {
      const created = table.create(data)
      auditLogs.create({
        action: 'CREATE',
        tableName: 'users',
        recordId: created.id,
        userId,
        data: JSON.stringify(data),
        createdAt: new Date()
      })
      return created
    },
    
    update(id: number, data: Partial<T>, userId: number) {
      const before = table.findById(id)
      const updated = table.update(id, data)
      auditLogs.create({
        action: 'UPDATE',
        tableName: 'users',
        recordId: id,
        userId,
        dataBefore: JSON.stringify(before),
        dataAfter: JSON.stringify(updated),
        createdAt: new Date()
      })
      return updated
    },
    
    delete(id: number, userId: number) {
      const before = table.findById(id)
      table.delete(id)
      auditLogs.create({
        action: 'DELETE',
        tableName: 'users',
        recordId: id,
        userId,
        data: JSON.stringify(before),
        createdAt: new Date()
      })
    }
  }
}
```

---

## Next Steps

- [Getting Started](./getting-started.md) - Getting started guide
- [API Reference](./api-reference.md) - Detailed API documentation
- [Schema Syntax](./schema-syntax.md) - Schema syntax
