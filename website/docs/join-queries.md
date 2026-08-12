# JOIN Queries

The `JoinQueryBuilder` lets you combine data from multiple tables, similar to SQL JOINs. It uses batch fetching internally to prevent N+1 query problems.

## Getting a JoinQueryBuilder

```ts
const joinQuery = db.from('posts').joinQuery()
```

## Setup

```ts
import { defineSheetsDB } from '@gsquery/core'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email'] as const,
      types: { id: 0, name: '', email: '' }
    },
    posts: {
      columns: ['id', 'title', 'body', 'authorId', 'published'] as const,
      types: { id: 0, title: '', body: '', authorId: 0, published: false }
    },
    comments: {
      columns: ['id', 'text', 'postId', 'userId'] as const,
      types: { id: 0, text: '', postId: 0, userId: 0 }
    }
  },
  mock: true
})

// Seed data
db.from('users').batchInsert([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' }
])

db.from('posts').batchInsert([
  { title: 'Hello World', body: '...', authorId: 1, published: true },
  { title: 'Draft Post',  body: '...', authorId: 2, published: false }
])

db.from('comments').batchInsert([
  { text: 'Great post!', postId: 1, userId: 2 },
  { text: 'Thanks!',     postId: 1, userId: 1 }
])
```

## Left Join (Default)

Returns all rows from the main table. Joined data is `null` if no match is found.

```ts
const postsWithAuthors = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id')
  .exec()

// [
//   { id: 1, title: 'Hello World', ..., users: { id: 1, name: 'Alice', ... } },
//   { id: 2, title: 'Draft Post',  ..., users: { id: 2, name: 'Bob',   ... } }
// ]
```

## Inner Join

Excludes rows from the main table that have no matching foreign row.

```ts
const postsWithAuthors = db.from('posts').joinQuery()
  .innerJoin('users', 'authorId', 'id')
  .exec()
```

## Aliasing

By default, joined data is nested under the target table name. Use `as` to choose a custom name:

```ts
const results = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
  .exec()

// [
//   { id: 1, title: 'Hello World', ..., author: { id: 1, name: 'Alice', ... } },
//   ...
// ]
```

## Multiple Joins

Chain multiple joins to combine several tables:

```ts
const commentsWithDetails = db.from('comments').joinQuery()
  .leftJoin('posts', 'postId', 'id', { as: 'post' })
  .leftJoin('users', 'userId', 'id', { as: 'author' })
  .exec()

// [
//   {
//     id: 1, text: 'Great post!', postId: 1, userId: 2,
//     post:   { id: 1, title: 'Hello World', ... },
//     author: { id: 2, name: 'Bob', ... }
//   },
//   ...
// ]
```

## Filtering

Use `where` to filter the main table before joining:

```ts
const publishedPostsWithAuthors = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('title')
  .exec()
```

> **Note:** `where` conditions apply to the main table only. To filter on joined data, filter the results after `exec()`.

## Sorting & Pagination

```ts
const results = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id')
  .orderBy('title', 'asc')
  .limit(10)
  .offset(0)
  .exec()

// Or use page()
const page2 = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id')
  .page(2, 10)
  .exec()
```

## Execution Methods

Same as regular QueryBuilder:

```ts
// All results
const all = joinQuery.exec()

// First result
const first = joinQuery.first()       // T | undefined
const must  = joinQuery.firstOrFail() // T (throws NoResultsError)

// Count
const n = joinQuery.count()

// Exists
const has = joinQuery.exists()
```

## How It Works (N+1 Prevention)

The JoinQueryBuilder avoids the N+1 problem through batch fetching:

1. Execute the main query to get all matching rows
2. Collect all unique foreign key values from the results
3. Batch-fetch all matching rows from the joined table using `IN` query
4. Create a lookup map and merge results

This means a join with 1000 main rows performs only **2 queries** (one for the main table, one for the joined table) instead of 1001.

## Cloning

```ts
const base = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })

const published = base.clone().where('published', '=', true).exec()
const drafts    = base.clone().where('published', '=', false).exec()
```

---

## See Also

- [Query Builder](./query-builder.md) -- Standard query operations (no joins)
- [Aggregation](./aggregation.md) -- Group and aggregate data
- [CRUD Operations](./crud-operations.md) -- Basic data operations
