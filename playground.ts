/**
 * Playground - Interactive testing space
 *
 * Run: npx tsx playground.ts
 */
import { defineSheetsDB, MockAdapter } from './src'

console.log('gas-sheets-query Playground\n')

// ============================================================================
// 1. DB Definition
// ============================================================================
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true }
    },
    posts: {
      columns: ['id', 'title', 'userId', 'views', 'published'] as const,
      types: { id: 0, title: '', userId: 0, views: 0, published: false }
    }
  },
  stores: {
    users: new MockAdapter(),
    posts: new MockAdapter()
  }
})

// ============================================================================
// 2. CRUD Test
// ============================================================================
console.log('=== Create ===')
const alice = db.from('users').create({ name: 'Alice', email: 'alice@test.com', age: 25, active: true })
const bob = db.from('users').create({ name: 'Bob', email: 'bob@test.com', age: 30, active: false })
const charlie = db.from('users').create({ name: 'Charlie', email: 'charlie@test.com', age: 22, active: true })
const david = db.from('users').create({ name: 'David', email: 'david@test.com', age: 28, active: true })
console.log(`Created ${db.from('users').findAll().length} users`)

// Posts
db.from('posts').create({ title: 'Hello World', userId: alice.id as number, views: 100, published: true })
db.from('posts').create({ title: 'Draft Post', userId: alice.id as number, views: 0, published: false })
db.from('posts').create({ title: "Bob's Post", userId: bob.id as number, views: 50, published: true })
console.log(`Created ${db.from('posts').findAll().length} posts`)

// ============================================================================
// 3. Query Test
// ============================================================================
console.log('\n=== Query ===')

// Active users sorted by age
const activeUsers = db.from('users')
  .query()
  .where('active', '=', true)
  .orderBy('age', 'asc')
  .exec()
console.log('Active users (by age):', activeUsers.map(u => `${u.name}(${u.age})`).join(', '))

// Age range
const midAge = db.from('users')
  .query()
  .where('age', '>=', 25)
  .where('age', '<=', 30)
  .exec()
console.log('Age 25-30:', midAge.map(u => u.name).join(', '))

// Published posts with views > 0
const popularPosts = db.from('posts')
  .query()
  .where('published', '=', true)
  .where('views', '>', 0)
  .orderBy('views', 'desc')
  .exec()
console.log('Popular posts:', popularPosts.map(p => `${p.title}(${p.views})`).join(', '))

// ============================================================================
// 4. Helper Methods Test
// ============================================================================
console.log('\n=== Helpers ===')

// first / firstOrFail
const firstActive = db.from('users').query().where('active', '=', true).first()
console.log('First active:', firstActive?.name)

// exists
const hasBob = db.from('users').query().where('name', '=', 'Bob').exists()
console.log('Bob exists:', hasBob)

// count
const activeCount = db.from('users').query().where('active', '=', true).count()
console.log('Active count:', activeCount)

// ============================================================================
// 5. Pagination
// ============================================================================
console.log('\n=== Pagination ===')

const page1 = db.from('users').query().orderBy('name').page(1, 2).exec()
const page2 = db.from('users').query().orderBy('name').page(2, 2).exec()
console.log('Page 1:', page1.map(u => u.name).join(', '))
console.log('Page 2:', page2.map(u => u.name).join(', '))

// ============================================================================
// 6. Update & Delete
// ============================================================================
console.log('\n=== Update & Delete ===')

// Update
const updated = db.from('users').update(alice.id, { age: 26 })
console.log('Updated Alice age:', updated.age)

// Delete
db.from('users').delete(david.id)
console.log('After delete:', db.from('users').findAll().map(u => u.name).join(', '))

// ============================================================================
// 7. Like Search
// ============================================================================
console.log('\n=== Like Search ===')

const emailSearch = db.from('users')
  .query()
  .whereLike('email', '%@test.com')
  .exec()
console.log('Emails ending with @test.com:', emailSearch.length)

const nameSearch = db.from('users')
  .query()
  .whereLike('name', 'A%')
  .exec()
console.log('Names starting with A:', nameSearch.map(u => u.name).join(', '))

// ============================================================================
console.log('\nPlayground complete!')
