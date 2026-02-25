# gsquery Cheatsheet — Google Sheets as a Database

> TypeScript library for using Google Sheets as a typed database in GAS projects.
> Packages: `@gsquery/core`, `@gsquery/client`, `@gsquery/cli` (v0.9.0)

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const, // as const required!
      types: { id: 0, name: '', email: '', age: 0, active: true },
    },
    posts: {
      columns: ['id', 'title', 'body', 'authorId', 'published'] as const,
      types: { id: 0, title: '', body: '', authorId: 0, published: false },
    },
  },
  mock: true, // MockAdapter for testing; omit or use stores: {} for production
})
```

## CRUD

```ts
const users = db.from('users')
users.create({ name: 'Alice', email: 'a@test.com', age: 30, active: true }) // omit id
users.findAll()                    // T[]
users.findById(1)                  // T — throws RowNotFoundError
users.update(1, { age: 31 })      // T — throws RowNotFoundError
users.delete(1)                    // void — throws RowNotFoundError
users.batchInsert([{...}, {...}])  // T[]
users.batchUpdate([{ id: 1, data: { active: false } }])

// Null-safe (via Repository)
users.repo.findByIdOrNull(1)      // T | undefined
users.repo.updateOrNull(1, {})    // T | undefined
users.repo.deleteIfExists(1)      // boolean
```

## Queries

```ts
db.from('users').query()
  .where('active', '=', true)        // operators: = != > >= < <= like in
  .where('age', '>=', 18)            // multiple where = AND
  .whereEq('active', true)           // shorthand for =
  .whereNot('role', 'admin')         // shorthand for !=
  .whereIn('status', ['a', 'b'])     // shorthand for in
  .whereLike('name', 'A%')           // % any chars, _ single char
  .orderBy('name', 'asc')            // default 'asc'
  .limit(10).offset(20)
  .page(1, 10)                       // 1-indexed!
  .exec()          // T[]
  .first()         // T | undefined
  .firstOrFail()   // T — throws NoResultsError
  .count()         // number (ignores limit/offset)
  .exists()        // boolean
  .sum('field')    // number (0 for empty)
  .avg('field')    // number | null
  .min('field')    // number | null
  .max('field')    // number | null
```

## Joins

```ts
db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
  .innerJoin('categories', 'categoryId', 'id')
  .where('published', '=', true)
  .exec()
// [{ ...post, author: { id, name } | null, categories: { id, name } }]
```

## Aggregation

```ts
db.from('orders').query()
  .groupBy('category')
  .having('total', '>', 1000)
  .agg({ count: 'count', total: 'sum:amount', avg: 'avg:price' })
// [{ category, count, total, avg }]
```

AggSpec: `'count'` | `'sum:field'` | `'avg:field'` | `'min:field'` | `'max:field'`

## Adapters

```ts
// MockAdapter (testing)
import { MockAdapter } from '@gsquery/core'
new MockAdapter<User>([...])
new MockAdapter<User>({ initialData: [...], indexes: [{ fields: ['email'], unique: true }] })

// SheetsAdapter (GAS production)
import { SheetsAdapter } from '@gsquery/core'
new SheetsAdapter<User>({
  sheetName: 'Users', columns: ['id', 'name', 'email'],
  columnTypes: { age: 'number', active: 'boolean', tags: 'string[]' },
})
```

## Migrations

```ts
import { createMigrationRunner, MockAdapter } from '@gsquery/core'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),
  storeResolver: (name) => db.getStore(name),
  migrations: [
    { version: 1, name: 'add-role',
      up: (s) => s.addColumn('users', 'role', { default: 'viewer' }),
      down: (s) => s.removeColumn('users', 'role') },
  ],
})
await runner.migrate()       // run pending
await runner.rollback()      // undo last
```

## CLI

```bash
gsquery init                                     # scaffold project
gsquery generate schema.gsq.yaml -o src/db       # generate types
gsquery migrate                                  # run migrations
gsquery rollback [--all]                         # undo migrations
gsquery migration:create add-role                # new migration file
```

## Errors

| Error | Code | Thrown By |
|-------|------|-----------|
| `RowNotFoundError` | `ROW_NOT_FOUND` | `findById`, `update`, `delete` |
| `NoResultsError` | `NO_RESULTS` | `firstOrFail()` |
| `TableNotFoundError` | `TABLE_NOT_FOUND` | `db.from('unknown')` |
| `ValidationError` | `VALIDATION_ERROR` | Input validation |
| `InvalidOperatorError` | `INVALID_OPERATOR` | Bad operator in `where()` |

All extend `SheetsQueryError`. Use `instanceof` or check `.code`.

## Viz API (GAS)

```ts
import { buildVizQuery, createVizFetcher } from '@gsquery/core'
const fetcher = createVizFetcher('sheet-id', { sheet: 'Users', columnMap: { id: 'A', name: 'B' } })
const result = fetcher(queryOpts, ['id', 'name'])
```

## Common Mistakes

- Always use `as const` on columns array
- `findById` throws — use `repo.findByIdOrNull()` for null-safe
- `page()` is 1-indexed, not 0-indexed
- Multiple `where()` = AND, use `whereIn()` for OR
- Join results are nested: `result.author.name`, not `result.authorName`
- `agg()` requires `groupBy()` — use `.sum()` etc. for ungrouped
- `SheetsAdapter` only works in GAS runtime
- `createVizFetcher` only works in GAS — use `buildVizUrl` in Node.js
