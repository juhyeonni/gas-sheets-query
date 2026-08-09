# @gsquery/core

> Use Google Sheets like a database — the runtime core of [gas-sheets-query](https://github.com/juhyeonni/gas-sheets-query)

`SheetsDB`, the query builder, the adapters (GAS / in-memory), migrations, and the testing fakes.

**📖 Full documentation lives in the [wiki](https://juhyeonni.github.io/gas-sheets-query/) — this README is just the tour.**

## Install

```bash
pnpm add @gsquery/core   # or: npm install @gsquery/core
```

## Quick Start

```typescript
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: { id: 0, name: '', email: '', role: '' }
    }
  },
  mock: true  // in-memory for tests; use stores: { users: new SheetsAdapter({...}) } on GAS
})

const user = db.from('users').create({ name: 'John', email: 'john@example.com', role: 'USER' })

const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

## Entry Points

| Import | Contents |
|---|---|
| `@gsquery/core` | `defineSheetsDB`, query/JOIN builders, `SheetsAdapter`, `MockAdapter`, migrations, errors |
| `@gsquery/core/testing` | GAS fakes (`FakeSheet`, …) and CSV/JSON fixture loaders for unit tests |

Ships ESM (`dist/index.mjs`), CJS (`dist/index.cjs`), and a standalone GAS bundle (`dist/gas/bundle.js`) for `clasp push`.

## Documentation

- [Installation](https://juhyeonni.github.io/gas-sheets-query/installation) · [Quick Start](https://juhyeonni.github.io/gas-sheets-query/quick-start)
- [Query Builder](https://juhyeonni.github.io/gas-sheets-query/query-builder) · [JOIN](https://juhyeonni.github.io/gas-sheets-query/join-queries) · [Aggregation](https://juhyeonni.github.io/gas-sheets-query/aggregation)
- [Adapters](https://juhyeonni.github.io/gas-sheets-query/adapters) · [Indexing & Performance](https://juhyeonni.github.io/gas-sheets-query/indexing-and-performance)
- [API Reference](https://juhyeonni.github.io/gas-sheets-query/api-reference)

Google Sheets is not a database engine — no transactions, full-table reads, per-execution caching. Read the Limitations section of the [project README](https://github.com/juhyeonni/gas-sheets-query) before you commit to it.

## License

[MIT](./LICENSE) © Juhyeon Lee
