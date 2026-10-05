/**
 * Type tests for JoinQueryBuilder.where() (#194, AC1, AC2, AC8)
 *
 * Compiled by `pnpm typecheck` (tsconfig.type-tests.json), never run.
 */
import { defineSheetsDB } from '../../src'
import type { JoinQueryBuilder, TableHandle, QueryBuilder, JoinWhereKey } from '../../src'
import type { Equal, Expect } from './assert'

// The setup from website/docs/join-queries.md
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

type Post = { id: number; title: string; body: string; authorId: number; published: boolean }

const posts = db.from('posts').joinQuery()

// ---------------------------------------------------------------------------
// AC1: main-table keys, bare or prefixed with the main table's name
// ---------------------------------------------------------------------------

posts.where('published', '=', true)
posts.where('posts.published', '=', true)
posts.where('title', 'like', '%Hello%')
posts.where('posts.title', '!=', 'Draft')
posts.where('authorId', '>', 1)
posts.where('posts.id', 'in', [1, 2])

// @ts-expect-error unknown key
posts.where('nope', '=', 'x')
// @ts-expect-error unknown key behind the main table's prefix
posts.where('posts.nope', '=', 'x')
// @ts-expect-error another table's field: where() filters the main table only
posts.where('users.name', '=', 'Alice')
// @ts-expect-error a joined table's key that the main table lacks
posts.where('email', '=', 'alice@example.com')

// ---------------------------------------------------------------------------
// AC2: the value is typed by the key, bare and prefixed, 'in' included
// ---------------------------------------------------------------------------

// @ts-expect-error boolean column, string value
posts.where('published', '=', 'yes')
// @ts-expect-error boolean column, string value, prefixed
posts.where('posts.published', '=', 'yes')
// @ts-expect-error number column, string value
posts.where('authorId', '>', '1')
// @ts-expect-error number column, string value, prefixed
posts.where('posts.authorId', '>', '1')
// @ts-expect-error 'in' takes an array of the column's type
posts.where('id', 'in', ['1'])
// @ts-expect-error 'in' takes an array of the column's type, prefixed
posts.where('posts.id', 'in', ['1'])
// @ts-expect-error 'in' takes an array, not a single value
posts.where('posts.id', 'in', 1)
// @ts-expect-error a single-value operator does not take an array
posts.where('posts.id', '=', [1])

// JoinWhereKey maps a field to the key it filters
type _k1 = Expect<Equal<JoinWhereKey<Post, 'posts.title'>, 'title'>>
type _k2 = Expect<Equal<JoinWhereKey<Post, 'title'>, 'title'>>
type _k3 = Expect<Equal<JoinWhereKey<Post, 'any.title'>, 'title'>>

// ---------------------------------------------------------------------------
// AC8: existing annotations and documented examples keep compiling
// ---------------------------------------------------------------------------

// The table name is carried as a literal type...
type TableNameOf<B> = B extends JoinQueryBuilder<infer _Row, infer N> ? N : never
type _named = Expect<Equal<TableNameOf<typeof posts>, 'posts'>>
type _handleNamed = Expect<Equal<TableNameOf<ReturnType<typeof handle.joinQuery>>, string>>

// ...and the old one-argument annotations still accept it
const handle: TableHandle<Post> = db.from('posts')
const loose: JoinQueryBuilder<Post> = db.from('posts').joinQuery()
const fromHandle: JoinQueryBuilder<Post> = handle.joinQuery()
const plain: QueryBuilder<Post> = db.from('posts').query()
const cloned: JoinQueryBuilder<Post> = posts.clone()

// With the default `string` name, any prefix compiles before a valid key; the
// runtime check rejects a wrong one. Keys and values are still checked.
loose.where('posts.published', '=', true)
loose.where('published', '=', false)
fromHandle.where('anything.title', '=', 'x')
// @ts-expect-error unknown key, even without a known table name
loose.where('posts.nope', '=', 'x')
// @ts-expect-error value typed by the key, even without a known table name
loose.where('posts.published', '=', 'yes')

plain.where('published', '=', true)
cloned.where('posts.title', '=', 'x')

// website/docs/join-queries.md
db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('title')
  .exec()

const base = db.from('posts').joinQuery()
  .leftJoin('users', 'authorId', 'id', { as: 'author' })
base.clone().where('published', '=', true).exec()
base.clone().where('published', '=', false).exec()

db.from('comments').joinQuery()
  .leftJoin('posts', 'postId', 'id', { as: 'post' })
  .leftJoin('users', 'userId', 'id', { as: 'author' })
  .where('comments.postId', '=', 1)
  .exec()

// Shorthands keep taking bare keys
posts.whereEq('published', true).whereIn('id', [1, 2]).whereNot('title', 'x').whereLike('title', '%a%')
