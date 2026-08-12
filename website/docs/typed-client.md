# Typed Client

The `@gsquery/client` package provides a typed client factory with environment detection, generated from your schema.

## Installation

```bash
pnpm add @gsquery/core @gsquery/client
pnpm add -D @gsquery/cli
```

## Creating a Client Factory

`createClientFactory<Tables>(schema)` returns a **factory function**. Row types come from the `Tables` type parameter; the `schema` only carries `columns` (and an optional `sheetName`) per table -- there is no `types` sample field here (that belongs to `defineSheetsDB`).

```ts
import { createClientFactory } from '@gsquery/client'
import { SheetsAdapter } from '@gsquery/core'

type User = { id: number; name: string; email: string; age: number }
type Post = { id: number; title: string; authorId: number }

const createClient = createClientFactory<{ users: User; posts: Post }>({
  tables: {
    users: { columns: ['id', 'name', 'email', 'age'] },
    posts: { columns: ['id', 'title', 'authorId'] }
  }
})
```

## Using the Factory

The factory is a function -- call it directly with `ClientOptions` (`spreadsheetId`, `mock`, `stores`, `idMode`).

### Production (Google Sheets)

```ts
const db = createClient({
  stores: {
    users: new SheetsAdapter({
      sheetName: 'users',
      columns: ['id', 'name', 'email', 'age']
    }),
    posts: new SheetsAdapter({
      sheetName: 'posts',
      columns: ['id', 'title', 'authorId']
    })
  }
})

const user = db.from('users').findById(1)
```

### Testing (Mock)

```ts
const db = createClient({ mock: true })

// Full type safety and autocomplete
db.from('users').create({ name: 'Alice', email: 'alice@example.com', age: 30 })
```

## Mock Client Shorthand

For tests, use `createMockClient` directly:

```ts
import { createMockClient } from '@gsquery/client'

type User = { id: number; name: string; email: string }

const db = createMockClient<{ users: User }>({
  tables: {
    users: { columns: ['id', 'name', 'email'] }
  }
})

// Ready to use with mock data
db.from('users').create({ name: 'Test User', email: 'test@example.com' })
```

## Environment Detection

The package exports `isGASEnvironment()` and `isNodeEnvironment()` for automatic adapter selection:

```ts
import { isGASEnvironment } from '@gsquery/client'

const db = createClient({
  stores: isGASEnvironment()
    ? {
        users: new SheetsAdapter({ sheetName: 'users', columns: ['id', 'name', 'email', 'age'] }),
        posts: new SheetsAdapter({ sheetName: 'posts', columns: ['id', 'title', 'authorId'] })
      }
    : undefined,
  mock: !isGASEnvironment()
})
```

## Generated Client (via CLI)

Run `gsquery generate --client` to generate a typed client from your schema:

```bash
npx gsquery generate -s schema.gsq.yaml -o src/generated --client
```

The client is written into your project at `<output>/client` (here
`src/generated/client/`), so it is committed with your code and survives
reinstalls. Override the location with `--client-output <path>` or the
`clientDir` field in `gsquery.config.json`.

The generated client includes:

1. **Type definitions** for all tables (the `Tables` map)
2. **Pre-configured schema** matching your YAML
3. **`createClient` factory function** ready to use

```ts
// src/generated/client/client.ts (auto-generated)
import { createClientFactory, type GeneratedSchema } from '@gsquery/client'
import type { Tables } from './types.js'

export const schema: GeneratedSchema = { /* ... */ }

export const createClient = createClientFactory<Tables>(schema)
```

Usage:

```ts
import { createClient } from './src/generated/client'

const db = createClient({ mock: true })
```

---

## See Also

- [CLI Reference](./cli-reference.md) -- `gsquery generate` command
- [Schema Definition](./schema-definition.md) -- Defining your schema
- [Adapters](./adapters.md) -- MockAdapter and SheetsAdapter
