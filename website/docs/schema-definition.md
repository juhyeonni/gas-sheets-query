# Schema Definition

gas-sheets-query supports two ways to define your database schema: **inline TypeScript** and **YAML schema files** (used with the CLI).

## Inline TypeScript Schema

The simplest approach. Define schemas directly in code using `defineSheetsDB`:

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true }
    }
  },
  mock: true
})
```

### Type Hints

The `types` object uses **sample values** to infer TypeScript types:

| Sample | Inferred Type |
|--------|---------------|
| `0`, `1`, `42` | `number` |
| `''`, `'sample'` | `string` |
| `true`, `false` | `boolean` |
| `new Date()` | `Date` |
| `null` | `null` |

> **Tip:** Always use `as const` on the `columns` array for proper type inference.

## YAML Schema (GSQ Format)

For larger projects, define your schema in a `.gsq.yaml` file and use the CLI to generate TypeScript types.

### Basic Structure

```yaml
# schema.gsq.yaml
tables:
  User:
    fields:
      id:       number    @id
      name:     string
      email:    string    @unique
      age:      number?                  # nullable
      active:   boolean   @default(true)

  Post:
    fields:
      id:        number   @id
      title:     string
      body:      string
      userId:    number
      published: boolean  @default(false)
      createdAt: datetime @default(now)
```

### Field Types

| Type | Description | TypeScript |
|------|-------------|------------|
| `string` | Text values | `string` |
| `number` | Numeric values | `number` |
| `boolean` | True/false | `boolean` |
| `datetime` | Date and time | `Date` |
| `string?` | Nullable string | `string \| null` |
| `number?` | Nullable number | `number \| null` |
| `string[]` | String array | `string[]` |
| `number[]` | Number array | `number[]` |

### Enum Definitions

```yaml
enums:
  Role:
    - admin
    - editor
    - viewer

tables:
  User:
    fields:
      id:   number  @id
      name: string
      role: Role    @default(viewer)
```

### Field Attributes

| Attribute | Description | Example |
|-----------|-------------|---------|
| `@id` | Primary key field | `id: number @id` |
| `@default(value)` | Declared default value (documentation only — see below) | `active: boolean @default(true)` |
| `@unique` | Unique constraint (declarative only — not enforced at runtime) | `email: string @unique` |
| `@updatedAt` | Declared update timestamp (documentation only — see below) | `updatedAt: datetime @updatedAt` |
| `@relation(Table)` | Foreign key referencing another table's `id` — see below | `authorId: number @relation(User)` |

:::warning `@default` and `@updatedAt` are not applied at runtime
These attributes are parsed and carried through codegen as documentation of intent, but **no adapter applies them**: generated `create()` types still require the fields, and nothing auto-fills timestamps on update. Supply the values from your application code (e.g. `create({ ..., createdAt: new Date() })`). Runtime application is planned for a later release.
:::

### `@relation(Table)`

Marks a field as a foreign key referencing another table's `id`. The generator emits a type alias per referenced table and uses it as the field's type.

```yaml
tables:
  User:
    fields:
      id: number @id @default(autoincrement)

  Task:
    fields:
      id: number @id @default(autoincrement)
      assigneeId: number? @relation(User)
      watcherIds: number[]? @relation(User)
```

```typescript
export type UserId = User['id']

export interface Task {
  id: number
  assigneeId?: UserId
  watcherIds?: UserId[]
}
```

**The field's type must match the referenced table's `id` type.** `User.id` is `number` above, so the foreign keys are `number` / `number[]`; declaring `assigneeId: string @relation(User)` is rejected by schema validation, because the emitted `UserId` would resolve to `number` and contradict the declaration.

`@relation` is also what [`gsquery visualize`](./cli-reference.md#gsquery-visualize) draws relationship edges from — a schema with no `@relation` renders as unconnected boxes.

:::note `@relation` is a typing and documentation aid
It adds no runtime behaviour: no automatic JOIN, no foreign-key integrity check on write, no cascade delete. Use `joinQuery()` to join explicitly.
:::

### Block Attributes

Indexes and composite unique constraints are declared with sibling `indexes:` and `unique:` keys, each holding a list of field-name arrays:

```yaml
tables:
  Post:
    fields:
      id:     number @id
      userId: number
      slug:   string
      title:  string
    indexes:
      - [userId]
    unique:
      - [userId, slug]
```

### Generate Types from Schema

```bash
npx gsquery generate                  # uses default schema.gsq.yaml
# or specify the schema path explicitly:
npx gsquery generate -s schema.gsq.yaml
```

This generates TypeScript types and a typed client.

---

## See Also

- [CLI Reference](./cli-reference.md) -- `gsquery init` and `gsquery generate` commands
- [Typed Client](./typed-client.md) -- Using the generated typed client
- [Quick Start](./quick-start.md) -- Getting started tutorial
