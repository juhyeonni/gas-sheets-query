/**
 * Basic CRUD Example
 *
 * Basic CRUD operations using gas-sheets-query
 */
import { defineSheetsDB, MockAdapter } from '@gsquery/core'

// =============================================================================
// 1. Type Definitions
// =============================================================================

interface User {
  id: number
  name: string
  email: string
  role: 'USER' | 'ADMIN'
  active: boolean
  createdAt: Date
}

// =============================================================================
// 2. DB Initialization
// =============================================================================

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role', 'active', 'createdAt'] as const,
      types: {
        id: 0,
        name: '',
        email: '',
        role: 'USER' as const,
        active: true,
        createdAt: new Date()
      }
    }
  },
  stores: {
    users: new MockAdapter<User>()
  }
})

// Get table handle
const users = db.from('users')

// =============================================================================
// 3. CREATE
// =============================================================================

console.log('=== CREATE ===')

// Single create
const john = users.create({
  name: 'John Doe',
  email: 'john@example.com',
  role: 'USER',
  active: true,
  createdAt: new Date()
})
console.log('Created user:', john)

// Batch create
const newUsers = users.batchInsert([
  { name: 'Alice Smith', email: 'alice@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Bob Wilson', email: 'bob@example.com', role: 'ADMIN', active: true, createdAt: new Date() },
  { name: 'Carol Brown', email: 'carol@example.com', role: 'USER', active: false, createdAt: new Date() }
])
console.log('Batch created:', newUsers.length, 'users')

// =============================================================================
// 4. READ
// =============================================================================

console.log('\n=== READ ===')

// Find by ID
const foundUser = users.findById(john.id)
console.log('Found by ID:', foundUser?.name)

// Find all
const allUsers = users.findAll()
console.log('Total users:', allUsers.length)

// Conditional query
const activeUsers = users.query()
  .where('active', '=', true)
  .exec()
console.log('Active users:', activeUsers.length)

// First result
const firstAdmin = users.query()
  .where('role', '=', 'ADMIN')
  .first()
console.log('First admin:', firstAdmin?.name)

// =============================================================================
// 5. UPDATE
// =============================================================================

console.log('\n=== UPDATE ===')

// Single update
users.update(john.id, { name: 'John Smith' })
const updatedJohn = users.findById(john.id)
console.log('Updated name:', updatedJohn?.name)

// Role change
users.update(john.id, { role: 'ADMIN' })
const adminJohn = users.findById(john.id)
console.log('Updated role:', adminJohn?.role)

// Batch update
users.batchUpdate([
  { id: newUsers[0].id, data: { active: false } },
  { id: newUsers[1].id, data: { name: 'Robert Wilson' } }
])
console.log('Batch updated 2 users')

// =============================================================================
// 6. DELETE
// =============================================================================

console.log('\n=== DELETE ===')

// Single delete
const beforeDelete = users.findAll().length
users.delete(john.id)
const afterDelete = users.findAll().length
console.log('Deleted 1 user:', beforeDelete, '->', afterDelete)

// Conditional delete (inactive users)
const inactiveUsers = users.query().where('active', '=', false).exec()
for (const user of inactiveUsers) {
  users.delete(user.id)
}
console.log('Deleted', inactiveUsers.length, 'inactive users')

// =============================================================================
// 7. Final State
// =============================================================================

console.log('\n=== FINAL STATE ===')
const finalUsers = users.findAll()
console.log('Remaining users:', finalUsers.length)
finalUsers.forEach(u => {
  console.log(`  - ${u.name} (${u.role}, active: ${u.active})`)
})
