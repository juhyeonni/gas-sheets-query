import { describe, it, expect, beforeEach } from 'vitest'
import { defineSheetsDB, SheetsDB, MockAdapter } from '../../src'
import type { RowWithId } from '../../src/core/types'

// Test types
interface User extends RowWithId {
  id: number
  name: string
  email: string
}

interface Post extends RowWithId {
  id: number
  title: string
  content: string
  authorId: number
  status: string
}

interface Comment extends RowWithId {
  id: number
  postId: number
  authorId: number
  text: string
}

interface Category extends RowWithId {
  id: number
  name: string
}

interface PostCategory extends RowWithId {
  id: number
  postId: number
  categoryId: number
}

describe('JoinQueryBuilder', () => {
  let usersAdapter: MockAdapter<User>
  let postsAdapter: MockAdapter<Post>
  let commentsAdapter: MockAdapter<Comment>
  let categoriesAdapter: MockAdapter<Category>
  let postCategoriesAdapter: MockAdapter<PostCategory>
  let db: SheetsDB<{
    users: User
    posts: Post
    comments: Comment
    categories: Category
    postCategories: PostCategory
  }>

  beforeEach(() => {
    usersAdapter = new MockAdapter<User>()
    postsAdapter = new MockAdapter<Post>()
    commentsAdapter = new MockAdapter<Comment>()
    categoriesAdapter = new MockAdapter<Category>()
    postCategoriesAdapter = new MockAdapter<PostCategory>()

    db = defineSheetsDB({
      tables: {
        users: {
          columns: ['id', 'name', 'email'] as const,
          types: { id: 0, name: '', email: '' }
        },
        posts: {
          columns: ['id', 'title', 'content', 'authorId', 'status'] as const,
          types: { id: 0, title: '', content: '', authorId: 0, status: '' }
        },
        comments: {
          columns: ['id', 'postId', 'authorId', 'text'] as const,
          types: { id: 0, postId: 0, authorId: 0, text: '' }
        },
        categories: {
          columns: ['id', 'name'] as const,
          types: { id: 0, name: '' }
        },
        postCategories: {
          columns: ['id', 'postId', 'categoryId'] as const,
          types: { id: 0, postId: 0, categoryId: 0 }
        }
      },
      stores: {
        users: usersAdapter,
        posts: postsAdapter,
        comments: commentsAdapter,
        categories: categoriesAdapter,
        postCategories: postCategoriesAdapter
      }
    })

    // Seed test data
    usersAdapter.reset([
      { id: 1, name: 'Alice', email: 'alice@test.com' },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
      { id: 3, name: 'Charlie', email: 'charlie@test.com' }
    ])

    postsAdapter.reset([
      { id: 1, title: 'First Post', content: 'Hello world', authorId: 1, status: 'published' },
      { id: 2, title: 'Second Post', content: 'Another post', authorId: 1, status: 'draft' },
      { id: 3, title: 'Third Post', content: 'Bob writes', authorId: 2, status: 'published' },
      { id: 4, title: 'Orphan Post', content: 'No author', authorId: 999, status: 'published' }
    ])

    commentsAdapter.reset([
      { id: 1, postId: 1, authorId: 2, text: 'Nice post!' },
      { id: 2, postId: 1, authorId: 3, text: 'I agree' },
      { id: 3, postId: 3, authorId: 1, text: 'Thanks Bob' }
    ])

    categoriesAdapter.reset([
      { id: 1, name: 'Tech' },
      { id: 2, name: 'Life' }
    ])

    postCategoriesAdapter.reset([
      { id: 1, postId: 1, categoryId: 1 },
      { id: 2, postId: 1, categoryId: 2 },
      { id: 3, postId: 3, categoryId: 1 }
    ])
  })

  describe('single join', () => {
    it('should join posts with users', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .where('status', '=', 'published')
        .exec()

      expect(posts.length).toBe(3)
      
      // First post by Alice
      const firstPost = posts.find(p => p.id === 1)
      expect(firstPost?.users).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' })
      
      // Third post by Bob
      const thirdPost = posts.find(p => p.id === 3)
      expect(thirdPost?.users).toEqual({ id: 2, name: 'Bob', email: 'bob@test.com' })
    })

    it('should handle null foreign keys (left join)', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .exec()

      // Orphan post (authorId: 999) should have null user
      const orphan = posts.find(p => p.id === 4)
      expect(orphan?.users).toBeNull()
    })

    it('should use custom alias with "as" option', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id', { as: 'author' })
        .where('status', '=', 'published')
        .exec()

      const firstPost = posts.find(p => p.id === 1)
      expect(firstPost?.author).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' })
      expect(firstPost?.users).toBeUndefined()
    })
  })

  describe('inner join', () => {
    it('should exclude rows without matching foreign data', () => {
      const posts = db.from('posts')
        .joinQuery()
        .innerJoin('users', 'authorId', 'id')
        .exec()

      // Orphan post should be excluded
      expect(posts.length).toBe(3)
      expect(posts.find(p => p.id === 4)).toBeUndefined()
    })

    it('should work with where conditions', () => {
      const posts = db.from('posts')
        .joinQuery()
        .innerJoin('users', 'authorId', 'id', { as: 'author' })
        .where('status', '=', 'published')
        .exec()

      expect(posts.length).toBe(2) // First post and third post (not orphan)
      expect(posts.every(p => p.author !== null)).toBe(true)
    })
  })

  describe('multiple joins', () => {
    it('should support chaining multiple joins', () => {
      const comments = db.from('comments')
        .joinQuery()
        .join('posts', 'postId', 'id', { as: 'post' })
        .join('users', 'authorId', 'id', { as: 'author' })
        .exec()

      expect(comments.length).toBe(3)

      // First comment
      const firstComment = comments.find(c => c.id === 1)
      expect(firstComment?.post).toEqual({
        id: 1, title: 'First Post', content: 'Hello world', authorId: 1, status: 'published'
      })
      expect(firstComment?.author).toEqual({ id: 2, name: 'Bob', email: 'bob@test.com' })
    })

    it('should handle mix of left and inner joins', () => {
      // Add an orphan comment (post doesn't exist)
      commentsAdapter.insert({ postId: 999, authorId: 1, text: 'Orphan comment' })

      const comments = db.from('comments')
        .joinQuery()
        .innerJoin('posts', 'postId', 'id', { as: 'post' })
        .leftJoin('users', 'authorId', 'id', { as: 'author' })
        .exec()

      // Orphan comment should be excluded (inner join)
      expect(comments.length).toBe(3)
    })
  })

  describe('N+1 prevention', () => {
    it('should batch fetch related records', () => {
      // If we had N+1, we'd make 4 separate queries for users
      // With batch fetching, we make 1 query with IN clause
      
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .exec()

      expect(posts.length).toBe(4)
      
      // Verify all posts have correct user data
      const alicePosts = posts.filter(p => p.authorId === 1)
      expect(alicePosts.every(p => (p.users as User)?.name === 'Alice')).toBe(true)
      
      const bobPosts = posts.filter(p => p.authorId === 2)
      expect(bobPosts.every(p => (p.users as User)?.name === 'Bob')).toBe(true)
    })
  })

  describe('query builder methods', () => {
    it('should support orderBy', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .orderBy('title', 'desc')
        .exec()

      expect(posts[0].title).toBe('Third Post')
      expect(posts[posts.length - 1].title).toBe('First Post')
    })

    it('should support limit and offset', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .orderBy('id')
        .limit(2)
        .offset(1)
        .exec()

      expect(posts.length).toBe(2)
      expect(posts[0].id).toBe(2)
      expect(posts[1].id).toBe(3)
    })

    it('should support page helper', () => {
      const page1 = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .orderBy('id')
        .page(1, 2)
        .exec()

      const page2 = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .orderBy('id')
        .page(2, 2)
        .exec()

      expect(page1.length).toBe(2)
      expect(page1[0].id).toBe(1)
      
      expect(page2.length).toBe(2)
      expect(page2[0].id).toBe(3)
    })

    it('should support first()', () => {
      const post = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id', { as: 'author' })
        .where('status', '=', 'published')
        .orderBy('id')
        .first()

      expect(post?.id).toBe(1)
      expect(post?.author).toBeDefined()
    })

    it('should support firstOrFail()', () => {
      expect(() =>
        db.from('posts')
          .joinQuery()
          .where('status', '=', 'nonexistent')
          .firstOrFail()
      ).toThrow('No results found')
    })

    it('should support count()', () => {
      const count = db.from('posts')
        .joinQuery()
        .where('status', '=', 'published')
        .count()

      expect(count).toBe(3)
    })

    it('should support count() with inner join', () => {
      const count = db.from('posts')
        .joinQuery()
        .innerJoin('users', 'authorId', 'id')
        .where('status', '=', 'published')
        .count()

      expect(count).toBe(2) // Excludes orphan post
    })

    it('should support exists()', () => {
      expect(
        db.from('posts')
          .joinQuery()
          .where('status', '=', 'published')
          .exists()
      ).toBe(true)

      expect(
        db.from('posts')
          .joinQuery()
          .where('status', '=', 'nonexistent')
          .exists()
      ).toBe(false)
    })

    it('should support clone()', () => {
      const baseQuery = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .where('status', '=', 'published')

      const cloned = baseQuery.clone().limit(1)

      expect(baseQuery.exec().length).toBe(3)
      expect(cloned.exec().length).toBe(1)
    })
  })

  describe('where shorthands', () => {
    it('should support whereEq', () => {
      const posts = db.from('posts')
        .joinQuery()
        .whereEq('status', 'published')
        .exec()

      expect(posts.length).toBe(3)
    })

    it('should support whereNot', () => {
      const posts = db.from('posts')
        .joinQuery()
        .whereNot('status', 'draft')
        .exec()

      expect(posts.length).toBe(3) // All except draft
    })

    it('should support whereIn', () => {
      const posts = db.from('posts')
        .joinQuery()
        .whereIn('authorId', [1, 2])
        .exec()

      expect(posts.length).toBe(3) // Posts by Alice and Bob
    })

    it('should support whereLike', () => {
      const posts = db.from('posts')
        .joinQuery()
        .whereLike('title', '%Post')
        .exec()

      expect(posts.length).toBe(4) // All posts end with "Post"
    })
  })

  describe('edge cases', () => {
    it('should handle empty results', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .where('status', '=', 'nonexistent')
        .exec()

      expect(posts.length).toBe(0)
    })

    it('should handle query without joins', () => {
      const posts = db.from('posts')
        .joinQuery()
        .where('status', '=', 'published')
        .exec()

      expect(posts.length).toBe(3)
      expect(posts[0].users).toBeUndefined() // No join, no nested data
    })

    it('should strip table prefix from where field', () => {
      const posts = db.from('posts')
        .joinQuery()
        .join('users', 'authorId', 'id')
        .where('posts.status', '=', 'published')
        .exec()

      expect(posts.length).toBe(3)
    })

    it('should throw error for invalid join table', () => {
      expect(() =>
        db.from('posts')
          .joinQuery()
          .join('nonexistent', 'authorId', 'id')
          .exec()
      ).toThrow()
    })
  })
})
