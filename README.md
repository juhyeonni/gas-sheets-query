# gas-sheets-query

> A TypeScript library that lets you use Google Sheets like a database

Abstracts the repetitive Sheets CRUD + query logic when developing GAS (Google Apps Script) applications.

## ✨ Core Values

- 🔌 **Plug & Play** - Minimal configuration, ready to use
- 🛡️ **Type-safe** - Schema definition → automatic type inference
- ⚡ **Performance** - Fetch only needed data (indexing, partial reads)
- 🔄 **Portability** - Supports both GAS + local development environments
- 🧩 **Extensibility** - JOIN, Aggregation, Migration support

## 📦 Package Structure

```
gas-sheets-query/
├── packages/
│   ├── core/       # Core library (SheetsDB, QueryBuilder)
│   ├── cli/        # CLI tools (gsquery)
│   └── client/     # Generated typed client runtime
```

## 🚀 Quick Start

### 1. Installation

```bash
# npm
npm install @gsquery/core

# pnpm (recommended)
pnpm add @gsquery/core
```

### 2. Define Schema

```yaml
# schema.gsq.yaml
tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string
      role: string @default("USER")
      createdAt: datetime @default(now)
```

### 3. Generate Types

```bash
npx gsquery generate
```

### 4. Usage

```typescript
import { defineSheetsDB, MockAdapter } from '@gsquery/core'

// Create DB instance (mock: true for testing)
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: { id: 0, name: '', email: '', role: '' }
    }
  },
  mock: true  // Auto-creates MockAdapter for all tables
  // For production, use stores: { users: new SheetsAdapter({...}) }
})

// CRUD
const user = db.from('users').create({ name: 'John', email: 'john@example.com', role: 'USER' })
const found = db.from('users').findById(user.id)
db.from('users').update(user.id, { role: 'ADMIN' })
db.from('users').delete(user.id)

// Query
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

## 🛠 CLI Commands

| Command | Description |
|---------|-------------|
| `gsquery init` | Initialize project (creates gsq.config.json) |
| `gsquery generate` | Generate types/client code from schema |
| `gsquery migration:create <name>` | Create new migration file |
| `gsquery migrate` | Run migrations |
| `gsquery rollback` | Rollback last migration |

```bash
# Initialize
npx gsquery init --spreadsheet-id YOUR_SPREADSHEET_ID

# Generate types
npx gsquery generate

# Migration
npx gsquery migration:create add_users_table
npx gsquery migrate
npx gsquery rollback
```

## 📚 Documentation

- [Getting Started](./docs/getting-started.md) - Step-by-step guide
- [API Reference](./docs/api-reference.md) - Detailed API documentation
- [Examples](./docs/examples.md) - Practical examples
- [Schema Syntax](./docs/schema-syntax.md) - Schema syntax guide

## 🎯 Key Features

### Query Builder

```typescript
// Basic query
const users = db.from('users')
  .query()
  .where('active', '=', true)
  .where('age', '>', 18)
  .orderBy('name', 'asc')
  .limit(10)
  .exec()

// Convenience methods
db.from('users').query().whereEq('role', 'ADMIN')
db.from('users').query().whereIn('status', ['ACTIVE', 'PENDING'])
db.from('users').query().whereLike('name', 'John%')
```

### Aggregation

```typescript
// Single aggregation
const count = db.from('orders').query().count()
const total = db.from('orders').query().sum('amount')

// Group by aggregation
const stats = db.from('orders')
  .query()
  .groupBy('status')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgAmount: 'avg:amount'
  })
// [{ status: 'PAID', count: 10, totalAmount: 5000, avgAmount: 500 }, ...]
```

### JOIN

```typescript
const postsWithAuthors = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('status', '=', 'PUBLISHED')
  .exec()

// Result: [{ id, title, author: { id, name, email } }, ...]
```

### Migration

```typescript
// migrations/001_add_users.ts
export const migration = {
  version: 1,
  name: 'add_users_table',
  up: (db) => {
    db.addColumn('users', 'nickname', { default: '' })
  },
  down: (db) => {
    db.removeColumn('users', 'nickname')
  }
}
```

## 🗺 Roadmap

- [x] v0.1 - Core (MVP): Basic CRUD + Query Builder
- [x] v0.2 - Performance: Optimization, Batch, Indexing
- [x] v0.3 - Advanced Query: Visualization API, JOIN, Aggregation
- [x] v0.4 - DX: Migration, Schema Generator, CLI
- [ ] v1.0 - Production: npm publish, integration testing, release

## 📝 License

MIT

## 🤝 Contributing

Issues and PRs are welcome! See [Contributing Guide](./CONTRIBUTING.md).
