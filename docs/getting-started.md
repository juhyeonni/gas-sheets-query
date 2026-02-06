# Getting Started

A project setup guide using gas-sheets-query.

## Table of Contents

1. [Installation](#installation)
2. [Project Initialization](#project-initialization)
3. [Schema Definition](#schema-definition)
4. [Type Generation](#type-generation)
5. [DB Connection](#db-connection)
6. [Basic Usage](#basic-usage)

---

## Installation

### Node.js Requirements

- Node.js 18 or higher
- pnpm (recommended) or npm

### Package Installation

```bash
# pnpm (recommended)
pnpm add gas-sheets-query

# npm
npm install gas-sheets-query

# yarn
yarn add gas-sheets-query
```

---

## Project Initialization

### 1. Generate Config File with CLI

```bash
npx gsq init --spreadsheet-id YOUR_SPREADSHEET_ID
```

This command creates a `gsq.config.json` file:

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "migrationsDir": "migrations",
  "generatedDir": "generated",
  "schemaFile": "schema.gsq.yaml"
}
```

### 2. Options

| Option | Description |
|--------|-------------|
| `-s, --spreadsheet-id <id>` | Google Spreadsheet ID |
| `-f, --force` | Overwrite existing config file |

### 3. Finding Spreadsheet ID

You can find the ID from the Google Sheets URL:

```
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
```

---

## Schema Definition

### 1. Create Schema File

Create a `schema.gsq.yaml` file in your project root:

```yaml
# schema.gsq.yaml

enums:
  Role:
    - USER
    - ADMIN
    - MODERATOR

  Status:
    - ACTIVE
    - INACTIVE
    - PENDING

tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string
      nickname: string?
      role: Role @default(USER)
      status: Status @default(ACTIVE)
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt

  Post:
    fields:
      id: number @id @default(autoincrement)
      title: string
      content: string?
      authorId: number
      published: boolean @default(false)
      createdAt: datetime @default(now)
    indexes:
      - [authorId]
```

### 2. Schema Syntax

#### Types

| Type | TypeScript | Description |
|------|------------|-------------|
| `string` | `string` | String |
| `number` | `number` | Number |
| `boolean` | `boolean` | Boolean |
| `datetime` | `Date` | Date/Time |

#### Optional Type

```yaml
nickname: string?    # string | undefined
```

#### Attributes

| Attribute | Description |
|-----------|-------------|
| `@id` | Primary key |
| `@unique` | Unique constraint |
| `@default(value)` | Default value |
| `@updatedAt` | Auto-update timestamp |

#### Default Value Examples

```yaml
id: number @default(autoincrement)     # Auto-increment
active: boolean @default(true)          # Boolean
count: number @default(0)               # Number
role: Role @default(USER)               # Enum
createdAt: datetime @default(now)       # Current time
```

For detailed syntax, see [Schema Syntax](./schema-syntax.md).

---

## Type Generation

### 1. Generate Types Command

```bash
npx gsq generate
```

### 2. Generated Output

Files are generated in the `generated/` folder:

```
generated/
├── types.ts      # Type definitions
└── client.ts     # Typed DB client
```

#### types.ts

```typescript
export type Role = 'USER' | 'ADMIN' | 'MODERATOR'
export type Status = 'ACTIVE' | 'INACTIVE' | 'PENDING'

export interface User {
  id: number
  email: string
  name: string
  nickname?: string
  role: Role
  status: Status
  createdAt: Date
  updatedAt: Date
}

export interface Post {
  id: number
  title: string
  content?: string
  authorId: number
  published: boolean
  createdAt: Date
}
```

---

## DB Connection

### Local Development (MockAdapter)

Use `MockAdapter` for testing and local development:

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'
import type { User, Post } from './generated/types'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'email', 'name', 'role', 'createdAt'] as const,
      types: { id: 0, email: '', name: '', role: '', createdAt: new Date() }
    },
    posts: {
      columns: ['id', 'title', 'content', 'authorId', 'published', 'createdAt'] as const,
      types: { id: 0, title: '', content: '', authorId: 0, published: false, createdAt: new Date() }
    }
  },
  stores: {
    users: new MockAdapter<User>(),
    posts: new MockAdapter<Post>()
  }
})
```

### GAS Environment (SheetsAdapter)

Use SheetsAdapter when connecting to actual Google Sheets:

```typescript
// Running in GAS environment
import { createSheetsDB, SheetsAdapter } from 'gas-sheets-query'

const spreadsheet = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID')

const db = createSheetsDB({
  config: {
    spreadsheetId: 'YOUR_SPREADSHEET_ID',
    tables: {
      users: { columns: ['id', 'email', 'name', 'role'] },
      posts: { columns: ['id', 'title', 'authorId'] }
    }
  },
  stores: {
    users: new SheetsAdapter(spreadsheet.getSheetByName('users')),
    posts: new SheetsAdapter(spreadsheet.getSheetByName('posts'))
  }
})
```

---

## Basic Usage

### CRUD Operations

```typescript
// Create
const user = db.from('users').create({
  email: 'john@example.com',
  name: 'John Doe',
  role: 'USER'
})

// Read
const found = db.from('users').findById(user.id)
const all = db.from('users').findAll()

// Update
db.from('users').update(user.id, { name: 'John Smith' })

// Delete
db.from('users').delete(user.id)
```

### Queries

```typescript
// Conditional search
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .exec()

// Pagination
const page2 = db.from('users')
  .query()
  .page(2, 10)  // Page 2, 10 items per page
  .exec()

// First result
const first = db.from('users')
  .query()
  .where('email', '=', 'john@example.com')
  .first()
```

---

## Next Steps

- [API Reference](./api-reference.md) - Detailed API documentation
- [Examples](./examples.md) - Practical examples
- [Schema Syntax](./schema-syntax.md) - Detailed schema syntax
