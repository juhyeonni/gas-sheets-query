# gas-sheets-query

> A TypeScript library that lets you use Google Sheets like a database

Abstracts the repetitive Sheets CRUD + query logic when developing GAS (Google Apps Script) applications.

**📖 Full documentation lives in the [wiki](https://juhyeonni.github.io/gas-sheets-query/) — this README is just the tour.**

## ✨ Highlights

- 🔌 **Plug & Play** — minimal configuration, works bound to a Sheet or with an explicit spreadsheet ID
- 🛡️ **Type-safe** — schema definition → generated types and a typed client (strict TS, no `any`)
- ⚡ **Sheets-aware I/O** — one bulk read per query with per-execution caching, batched range writes, script-locked mutations
- 🔄 **Portability** — the same code runs on GAS (`SheetsAdapter`), in tests (`MockAdapter` + `@gsquery/core/testing` fakes), and in the browser (`@gsquery/client` local-first adapter)
- 🧩 **Extensibility** — query builder, JOIN, aggregation, schema migrations, code-gen CLI

## 📦 Packages

| Package | Purpose |
|---|---|
| `@gsquery/core` | SheetsDB, query builder, adapters, migrations |
| `@gsquery/cli` | `gsquery` — codegen, migration scaffolding |
| `@gsquery/client` | Browser runtime: typed client + local-first sync |
| `@gsquery/skills` | Context files for AI coding assistants |

## 🚀 Quick Start

```bash
pnpm add @gsquery/core   # or: npm install @gsquery/core
```

```typescript
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      // Sample values declare each column's TYPE (0 → number, '' → string):
      // they are never written anywhere, they only drive inference.
      types: { id: 0, name: '', email: '', role: '' }
    }
  },
  mock: true  // in-memory; see below for wiring real sheets on GAS
})

const user = db.from('users').create({ name: 'John', email: 'john@example.com', role: 'USER' })

const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

**On GAS (real sheets)**: name the table schema so its inferred row type can be handed to the adapter — `InferRowFromSchema` closes the loop:

```typescript
import { defineSheetsDB, SheetsAdapter } from '@gsquery/core'
import type { InferRowFromSchema } from '@gsquery/core'

const users = {
  columns: ['id', 'name', 'email', 'role'] as const,
  types: { id: 0, name: '', email: '', role: '' }
}

const db = defineSheetsDB({
  tables: { users },
  stores: {
    users: new SheetsAdapter<InferRowFromSchema<typeof users>>({
      sheetName: 'users',
      columns: [...users.columns]
    })
  }
})
```

Schema-first instead? Define `schema.gsq.yaml` and run `npx gsquery generate` — see [Quick Start](https://juhyeonni.github.io/gas-sheets-query/quick-start) and [Schema Definition](https://juhyeonni.github.io/gas-sheets-query/schema-definition).

## 🛠 CLI

| Command | Description |
|---------|-------------|
| `gsquery init` | Initialize project (creates `gsquery.config.json`) |
| `gsquery generate` | Generate types/client code from schema |
| `gsquery generate --client` | Also generate the typed client into your project |
| `gsquery migration:create <name>` | Create a migration file |
| `gsquery migrate` / `gsquery rollback` | **Preview** migrations/rollbacks — execution happens in the GAS runtime via `MigrationRunner` |

Details: [CLI Reference](https://juhyeonni.github.io/gas-sheets-query/cli-reference) · [Migration System](https://juhyeonni.github.io/gas-sheets-query/migration-system)

## 📚 Documentation

- [Installation](https://juhyeonni.github.io/gas-sheets-query/installation) · [Quick Start](https://juhyeonni.github.io/gas-sheets-query/quick-start)
- [Query Builder](https://juhyeonni.github.io/gas-sheets-query/query-builder) · [JOIN](https://juhyeonni.github.io/gas-sheets-query/join-queries) · [Aggregation](https://juhyeonni.github.io/gas-sheets-query/aggregation)
- [Adapters](https://juhyeonni.github.io/gas-sheets-query/adapters) · [ID Modes](https://juhyeonni.github.io/gas-sheets-query/id-modes) · [Error Handling](https://juhyeonni.github.io/gas-sheets-query/error-handling)
- [Testing Without GAS](https://juhyeonni.github.io/gas-sheets-query/testing) · [Deploying to Apps Script](https://juhyeonni.github.io/gas-sheets-query/installation#deploying-to-apps-script)
- [Typed Client](https://juhyeonni.github.io/gas-sheets-query/typed-client) · [Indexing & Performance](https://juhyeonni.github.io/gas-sheets-query/indexing-and-performance)
- [API Reference](https://juhyeonni.github.io/gas-sheets-query/api-reference)

## ⚠️ Limitations

Google Sheets is not a database engine — know what you're trading:

- **No transactions** — mutations are script-locked but not atomic across multiple operations; there is no rollback of applied writes.
- **Full-table reads** — queries read the data block once per execution and filter in memory; fine for thousands of rows, not for hundreds of thousands. Sheets caps at 10M cells.
- **Per-execution cache** — an adapter instance snapshots the sheet on first read; writes from other executions are invisible until `clearCache()` or a new execution.
- **Schema `@unique` / `@@index` are declarative only** — parsed and emitted, but not enforced at runtime; indexes accelerate the mock/local adapters, not `SheetsAdapter`.
- **Local-first client is single-tab** — two tabs sharing the same namespace can clobber each other's queued mutations.
- **Formula escaping is on by default** — user-supplied strings are stored as literal text (never executed as formulas); opt out per adapter with `allowFormulas: true` if you intentionally store formulas.
- **Columns are mapped by position** — if somebody inserts or reorders a column in the sheet, the layout no longer matches the schema. Every read and write checks the header row once per execution and throws `SchemaMismatchError` instead of silently reading and writing the wrong columns; opt out per adapter with `skipHeaderCheck: true`.
- **A hidden `_gsquery_meta` sheet holds id counters** — auto `idMode` persists a per-table monotonic counter there so a deleted row's id is never reused (expect gaps after deletions, like any SQL auto-increment). Deleting the sheet is safe: it is recreated and the counter re-bootstraps from the current max.

## 🤖 AI Coding Assistants

Install [`@gsquery/skills`](./packages/skills) so AI tools (Claude Code, Cursor, Copilot, etc.) write correct gsquery code:

```bash
npx openskills install @gsquery/skills
```

## 🤝 Contributing

Issues and PRs are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md), [Code of Conduct](./CODE_OF_CONDUCT.md), and [Security Policy](./SECURITY.md).

## 📝 License

[MIT](./LICENSE) © Juhyeon Lee
