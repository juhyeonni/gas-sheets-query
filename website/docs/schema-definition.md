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
| `@default(value)` | Default value | `active: boolean @default(true)` |
| `@unique` | Unique constraint | `email: string @unique` |
| `@updatedAt` | Auto-update timestamp | `updatedAt: datetime @updatedAt` |

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
