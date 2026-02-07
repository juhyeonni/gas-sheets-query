# API Reference

Complete API documentation for gas-sheets-query.

## Table of Contents

- [SheetsDB](#sheetsdb)
- [TableHandle](#tablehandle)
- [QueryBuilder](#querybuilder)
- [JoinQueryBuilder](#joinquerybuilder)
- [Aggregation](#aggregation)
- [Migration](#migration)
- [CLI Commands](#cli-commands)
- [Errors](#errors)

---

## SheetsDB

### defineSheetsDB

Factory function using schema-based automatic type inference. (Recommended)

```typescript
import { defineSheetsDB, MockAdapter } from '@gsquery/core'

const db = defineSheetsDB({
  spreadsheetId: 'optional-id',
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: {
        id: 0,          // → number
        name: '',       // → string
        email: '',      // → string
        role: ''        // → string
      }
    }
  },
  stores: {
    users: new MockAdapter()
  }
})
```

#### Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `spreadsheetId` | `string` | ✗ | Google Spreadsheet ID |
| `tables` | `Record<string, TableSchemaTyped>` | ✓ | Table schema definitions |
| `stores` | `Record<string, DataStore>` | ✓ | DataStore for each table |

### createSheetsDB

Legacy factory function using explicit types.

```typescript
import { createSheetsDB, MockAdapter } from '@gsquery/core'

interface User {
  id: number
  name: string
  email: string
}

const db = createSheetsDB<{ users: User }>({
  config: {
    tables: {
      users: { columns: ['id', 'name', 'email'] }
    }
  },
  stores: {
    users: new MockAdapter()
  }
})
```

### SheetsDB Interface

```typescript
interface SheetsDB<Tables> {
  // Get table handle
  from<K extends keyof Tables>(tableName: K): TableHandle<Tables[K]>
  
  // Access underlying DataStore
  getStore<K extends keyof Tables>(tableName: K): DataStore<Tables[K]>
  
  // Configuration
  readonly config: SheetsDBConfig
}
```

---

## TableHandle

Handle for table-specific CRUD and query operations.

### Properties and Methods

```typescript
interface TableHandle<T> {
  // Direct repository access
  readonly repo: Repository<T>
  
  // Create query builder
  query(): QueryBuilder<T>
  
  // JOIN-enabled query builder
  joinQuery(): JoinQueryBuilder<T>
  
  // CRUD shortcut methods
  create(data: Omit<T, 'id'>): T
  findById(id: string | number): T
  findAll(): T[]
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T
  delete(id: string | number): void
  
  // Batch operations
  batchInsert(data: Omit<T, 'id'>[]): T[]
  batchUpdate(items: { id: string | number; data: Partial<Omit<T, 'id'>> }[]): T[]
}
```

### Example

```typescript
const users = db.from('users')

// CRUD
const user = users.create({ name: 'John', email: 'john@example.com' })
const found = users.findById(1)
users.update(1, { name: 'John Doe' })
users.delete(1)

// Batch operations
const newUsers = users.batchInsert([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
])
```

---

## QueryBuilder

Build queries with a fluent interface.

### Creation

```typescript
const query = db.from('users').query()
```

### Conditions (Where)

```typescript
// Basic condition
query.where('field', 'operator', 'value')

// Supported operators
query.where('age', '=', 25)     // Equal
query.where('age', '!=', 25)    // Not equal
query.where('age', '>', 25)     // Greater than
query.where('age', '>=', 25)    // Greater than or equal
query.where('age', '<', 25)     // Less than
query.where('age', '<=', 25)    // Less than or equal
query.where('role', 'in', ['ADMIN', 'USER'])  // In list
query.where('name', 'like', 'John%')  // Pattern matching

// Shortcut methods
query.whereEq('role', 'ADMIN')           // where('role', '=', 'ADMIN')
query.whereNot('status', 'DELETED')      // where('status', '!=', 'DELETED')
query.whereIn('role', ['ADMIN', 'USER']) // where('role', 'in', [...])
query.whereLike('name', 'John%')         // where('name', 'like', ...)
```

### Sorting (OrderBy)

```typescript
query.orderBy('name', 'asc')   // Ascending
query.orderBy('createdAt', 'desc')  // Descending

// Multiple sort
query
  .orderBy('role', 'asc')
  .orderBy('name', 'asc')
```

### Pagination

```typescript
// limit/offset
query.limit(10)
query.offset(20)

// page (convenience method)
query.page(2, 10)  // Page 2, 10 per page = offset(10).limit(10)
```

### Execution

```typescript
// All results
const results: User[] = query.exec()

// First result
const first: User | undefined = query.first()

// First result (throws if not found)
const firstOrFail: User = query.firstOrFail()  // throws NoResultsError

// Result count
const count: number = query.count()

// Existence check
const exists: boolean = query.exists()
```

### Query Building

```typescript
// Build as options object (without executing)
const options = query
  .where('role', '=', 'ADMIN')
  .orderBy('name')
  .build()

// Clone
const cloned = query.clone()
```

### Full Example

```typescript
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .where('active', '=', true)
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

---

## JoinQueryBuilder

Extended QueryBuilder with JOIN support.

### Creation

```typescript
const query = db.from('posts').joinQuery()
```

### JOIN Methods

```typescript
// Basic JOIN (left join)
query.join('users', 'authorId', 'id')

// With alias
query.join('users', 'authorId', 'id', { as: 'author' })

// Left Join (explicit)
query.leftJoin('users', 'authorId', 'id')

// Inner Join (excludes non-matching)
query.innerJoin('users', 'authorId', 'id')
```

### Multiple JOINs

```typescript
const result = db.from('comments')
  .joinQuery()
  .join('posts', 'postId', 'id', { as: 'post' })
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// Result: { ...comment, post: {...}, author: {...} }
```

### Full Example

```typescript
const publishedPosts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .exec()

// Result: [
//   { id: 1, title: '...', author: { id: 1, name: 'John', ... } },
//   ...
// ]
```

---

## Aggregation

### Single Aggregation

```typescript
const query = db.from('orders').query()

// Count
const count = query.count()

// Sum
const total = query.sum('amount')

// Average
const average = query.avg('amount')

// Minimum
const min = query.min('amount')

// Maximum
const max = query.max('amount')
```

### Group Aggregation

```typescript
// Grouping
const stats = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .groupBy('category')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgAmount: 'avg:amount',
    minAmount: 'min:amount',
    maxAmount: 'max:amount'
  })

// Result: [
//   { category: 'FOOD', count: 50, totalAmount: 5000, avgAmount: 100, ... },
//   { category: 'DRINKS', count: 30, totalAmount: 1500, avgAmount: 50, ... }
// ]
```

### Having

```typescript
// Filter groups
const bigCategories = db.from('orders')
  .query()
  .groupBy('category')
  .having('count', '>', 10)  // Only groups with more than 10 items
  .agg({
    count: 'count',
    total: 'sum:amount'
  })
```

### AggSpec Types

| Spec | Description |
|------|-------------|
| `'count'` | Row count |
| `'sum:field'` | Field sum |
| `'avg:field'` | Field average |
| `'min:field'` | Field minimum |
| `'max:field'` | Field maximum |

---

## Migration

### MigrationRunner

```typescript
import { createMigrationRunner, MockAdapter } from '@gsquery/core'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),  // Store migration records
  storeResolver: (table) => stores[table],
  migrations: [
    {
      version: 1,
      name: 'add_nickname_column',
      up: (db) => {
        db.addColumn('users', 'nickname', { default: '' })
      },
      down: (db) => {
        db.removeColumn('users', 'nickname')
      }
    }
  ]
})
```

### Methods

```typescript
// Get current version
const version = runner.getCurrentVersion()

// Get pending migrations
const pending = runner.getPendingMigrations()

// Run migrations
const result = await runner.migrate()
// { applied: [{ version: 1, name: 'add_nickname' }], currentVersion: 1 }

// Migrate to specific version
await runner.migrate({ to: 3 })

// Rollback
const rollback = await runner.rollback()
// { rolledBack: { version: 1, name: '...' }, currentVersion: 0 }

// Rollback all
await runner.rollbackAll()

// Get status
const status = runner.getStatus()
// { currentVersion: 1, applied: [...], pending: [...] }
```

### SchemaBuilder Methods

```typescript
interface SchemaBuilder {
  // Add column
  addColumn(table: string, column: string, options?: {
    default?: unknown
    type?: 'string' | 'number' | 'boolean' | 'date'
  }): void
  
  // Remove column
  removeColumn(table: string, column: string): void
  
  // Rename column
  renameColumn(table: string, oldName: string, newName: string): void
}
```

---

## CLI Commands

### gsquery init

Initialize project.

```bash
gsquery init [options]

Options:
  -s, --spreadsheet-id <id>   Google Spreadsheet ID
  -f, --force                 Overwrite existing config
```

Generated `gsquery.config.json`:

```json
{
  "spreadsheetId": "YOUR_ID",
  "migrationsDir": "migrations",
  "generatedDir": "generated",
  "schemaFile": "schema.gsq.yaml"
}
```

### gsquery generate

Generate types and client from schema.

```bash
gsquery generate [options]

Options:
  -s, --schema <path>     Schema file path (default: schema.gsq.yaml)
  -o, --output <dir>      Output directory (default: generated/)
```

Generated files:
- `generated/types.ts` - Type definitions
- `generated/client.ts` - DB client

### gsquery migration:create

Create new migration file.

```bash
gsquery migration:create <name>

Examples:
  gsquery migration:create add_users_table
  gsquery migration:create add_nickname_to_users
```

Generated file:
- `migrations/NNNN_name.ts`

### gsquery migrate

Run pending migrations.

```bash
gsquery migrate [options]

Options:
  --to <version>    Migrate to specific version only
```

### gsquery rollback

Rollback last migration.

```bash
gsquery rollback
```

---

## Errors

### Error Classes

| Error | Description |
|-------|-------------|
| `SheetsQueryError` | Base error class |
| `TableNotFoundError` | Table not found |
| `RowNotFoundError` | Row not found |
| `NoResultsError` | No query results (`firstOrFail`) |
| `MissingStoreError` | DataStore not found |
| `ValidationError` | Validation failed |
| `InvalidOperatorError` | Invalid operator |
| `MigrationVersionError` | Migration version error |
| `MigrationExecutionError` | Migration execution failed |
| `NoMigrationsToRollbackError` | No migrations to rollback |

### Example

```typescript
import { TableNotFoundError, NoResultsError } from '@gsquery/core'

try {
  const user = db.from('users')
    .query()
    .whereEq('email', 'unknown@example.com')
    .firstOrFail()
} catch (error) {
  if (error instanceof NoResultsError) {
    console.log('User not found')
  }
}
```

---

## Next Steps

- [Getting Started](./getting-started.md) - Getting started guide
- [Examples](./examples.md) - Practical examples
- [Schema Syntax](./schema-syntax.md) - Schema syntax
