---
description: Install @gsquery/core, @gsquery/cli, and @gsquery/client via pnpm, npm, or yarn, plus the prerequisites for GAS deployment.
---

# Installation

## Prerequisites

- **Node.js** >= 18
- **pnpm**, **npm**, or **yarn**
- (For GAS deployment) [clasp](https://github.com/google/clasp) CLI

## Install Packages

### Core only (most users)

```bash
# pnpm
pnpm add @gsquery/core

# npm
npm install @gsquery/core

# yarn
yarn add @gsquery/core
```

### With CLI (schema generation & migrations)

```bash
pnpm add @gsquery/core
pnpm add -D @gsquery/cli
```

### With Typed Client (auto-generated typed DB client)

```bash
pnpm add @gsquery/core @gsquery/client
pnpm add -D @gsquery/cli
```

## Which Packages Do I Need?

| Package | When to install |
|---------|----------------|
| `@gsquery/core` | Always -- contains Repository, QueryBuilder, Adapters |
| `@gsquery/cli` | If you use YAML schemas, type generation, or migrations |
| `@gsquery/client` | If you want a pre-typed client factory with environment detection |

## Verify Installation

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    test: {
      columns: ['id', 'value'] as const,
      types: { id: 0, value: '' }
    }
  },
  mock: true
})

console.log(db.from('test').findAll()) // []
```

---

## See Also

- [Quick Start](./quick-start.md) -- 60-second tutorial
- [Architecture Overview](./architecture-overview.md) -- How the packages fit together
- [CLI Reference](./cli-reference.md) -- CLI commands for schema and migration workflows
