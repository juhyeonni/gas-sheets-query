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
│   └── cli/        # CLI tools (gsq)
```

## 🚀 Quick Start

### 1. Installation

```bash
# npm
npm install gas-sheets-query

# pnpm (recommended)
pnpm add gas-sheets-query
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
npx gsq generate
```

### 4. Usage

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

// Create DB instance
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: { id: 0, name: '', email: '', role: '' }
    }
  },
  stores: {
    users: new MockAdapter()  // For testing, use SheetsAdapter in production
  }
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
| `gsq init` | Initialize project (creates gsq.config.json) |
| `gsq generate` | Generate types/client code from schema |
| `gsq migration:create <name>` | Create new migration file |
| `gsq migrate` | Run migrations |
| `gsq rollback` | Rollback last migration |

```bash
# Initialize
npx gsq init --spreadsheet-id YOUR_SPREADSHEET_ID

# Generate types
npx gsq generate

# Migration
npx gsq migration:create add_users_table
npx gsq migrate
npx gsq rollback
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
- [x] v0.5 - Schema Generator: CLI (`gsq generate`), type/client code generation
- [ ] v0.6 - Performance: Optimization, Batch, Indexing
- [ ] v0.7 - Advanced Query: Visualization API, JOIN, Aggregation
- [ ] v0.8 - DX: Migration, Documentation
- [ ] v1.0 - Production: npm publish, real-world validation

## 📝 License

MIT

## 🤝 Contributing

Issues and PRs are welcome! See [Contributing Guide](./CONTRIBUTING.md).
