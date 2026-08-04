---
description: How the layers fit together — application code, TableHandle, Repository, QueryBuilder, and the DataStore adapters backing Google Sheets.
---

# Architecture Overview

## Layer Diagram

```
┌─────────────────────────────────────────────┐
│              Your Application                │
├─────────────────────────────────────────────┤
│  @gsquery/client   (optional typed client)   │
├─────────────────────────────────────────────┤
│  @gsquery/core                               │
│  ┌────────────────────────────────────────┐  │
│  │  SheetsDB (defineSheetsDB)             │  │
│  │  ┌──────────┐  ┌───────────────────┐   │  │
│  │  │TableHandle│  │ JoinQueryBuilder  │   │  │
│  │  └────┬─────┘  └───────────────────┘   │  │
│  │       │                                 │  │
│  │  ┌────┴─────┐  ┌──────────────┐        │  │
│  │  │Repository │  │ QueryBuilder │        │  │
│  │  └────┬─────┘  └──────┬───────┘        │  │
│  │       │               │                 │  │
│  │  ┌────┴───────────────┴──────┐          │  │
│  │  │      DataStore Interface  │          │  │
│  │  └────┬──────────────┬───────┘          │  │
│  │       │              │                  │  │
│  │  ┌────┴─────┐  ┌────┴──────────┐       │  │
│  │  │MockAdapter│  │SheetsAdapter  │       │  │
│  │  │(testing)  │  │(Google Sheets)│       │  │
│  │  └──────────┘  └───────────────┘       │  │
│  └────────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  @gsquery/cli   (dev tooling)                │
│  schema parser → type generator → migrations │
└─────────────────────────────────────────────┘
```

## Package Relationships

### `@gsquery/core`

The foundation. Contains all runtime code:

| Component | Purpose |
|-----------|---------|
| `defineSheetsDB` | Factory function -- creates a `SheetsDB` instance with type inference |
| `SheetsDB` | Entry point; provides `from(tableName)` to get table handles |
| `TableHandle` | Per-table interface for CRUD, queries, and batch operations |
| `Repository` | CRUD operations (create, findById, update, delete) |
| `QueryBuilder` | Fluent query API (where, orderBy, limit, aggregations) |
| `JoinQueryBuilder` | Query builder with JOIN support across tables |
| `MockAdapter` | In-memory `DataStore` for testing and development |
| `SheetsAdapter` | Google Sheets `DataStore` for production (GAS environment) |
| `IndexStore` | Column indexing for query optimization |
| `MigrationRunner` | Schema migration execution and tracking |
| Viz Query | Google Visualization API query builder |

### `@gsquery/cli`

Development-time tooling (not shipped to production):

| Component | Purpose |
|-----------|---------|
| `gsquery init` | Scaffold a new project with schema template |
| `gsquery generate` | Parse `.gsq.yaml` schema and generate TypeScript types |
| `gsquery migrate` | Run pending schema migrations |
| `gsquery rollback` | Roll back the last applied migration |

### `@gsquery/client`

Optional typed client layer:

| Component | Purpose |
|-----------|---------|
| `createClientFactory` | Creates a typed DB client factory with environment detection |
| `createMockClient` | Creates a mock client for testing |
| Generated types | Auto-generated from schema via CLI |

### `@gsquery/skills`

AI coding-assistant context files (not a runtime dependency):

| Component | Purpose |
|-----------|---------|
| Skill / reference files | Context for Claude Code, Cursor, Copilot to write correct gsquery code |
| `gsquery-skills` CLI | Installs skill files (`install`, `info`); auto-detects target (claude/cursor/generic) |
| Programmatic API | `getSkillFiles`, `getClaudeSkillFiles`, `getGenericSkillFiles`, `detectTarget`, `getDefaultDest` |

See [AI Assistant Skills](./ai-assistant-skills.md) for details.

## Key Interfaces

### `DataStore<T>`

The core abstraction. Both `MockAdapter` and `SheetsAdapter` implement this interface:

```ts
interface DataStore<T extends RowWithId> {
  findAll(): T[]
  find(options: QueryOptions<T>): T[]
  findById(id: string | number): T | undefined
  insert(data: T | Omit<T, 'id'>): T
  update(id: string | number, data: Partial<T>): T | undefined
  delete(id: string | number): boolean
  batchInsert?(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate?(items: BatchUpdateItem<T>[]): T[]
}
```

### `TableHandle<T>`

The primary interface you work with after calling `db.from('tableName')`:

```ts
interface TableHandle<T extends RowWithId> {
  readonly repo: Repository<T>
  query(): QueryBuilder<T>
  joinQuery(): JoinQueryBuilder<T>
  create(data: T | Omit<T, 'id'>): T
  findById(id: string | number): T
  findAll(): T[]
  update(id: string | number, data: Partial<T>): T
  delete(id: string | number): void
  batchInsert(data: (T | Omit<T, 'id'>)[]): T[]
  batchUpdate(items: { id: string | number; data: Partial<T> }[]): T[]
}
```

## Data Flow

```
User Code
  │
  ▼
db.from('users')          → returns TableHandle<User>
  │
  ├─ .create(data)        → Repository.create() → DataStore.insert()
  ├─ .findById(id)        → Repository.findById() → DataStore.findById()
  ├─ .query()             → returns QueryBuilder<User>
  │    └─ .where().exec() → DataStore.find(options)
  └─ .joinQuery()         → returns JoinQueryBuilder<User>
       └─ .join().exec()  → DataStore.find() + batch fetch joined rows
```

---

## See Also

- [Adapters](./adapters.md) -- MockAdapter vs SheetsAdapter in detail
- [CRUD Operations](./crud-operations.md) -- Using TableHandle for data operations
- [Query Builder](./query-builder.md) -- Fluent query API reference
