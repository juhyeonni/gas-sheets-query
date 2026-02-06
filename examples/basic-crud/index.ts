/**
 * Basic CRUD Example
 * 
 * gas-sheets-query를 사용한 기본 CRUD 작업 예제
 */
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

// =============================================================================
// 1. 타입 정의
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
// 2. DB 초기화
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

// 테이블 핸들 가져오기
const users = db.from('users')

// =============================================================================
// 3. CREATE - 데이터 생성
// =============================================================================

console.log('=== CREATE ===')

// 단일 생성
const john = users.create({
  name: 'John Doe',
  email: 'john@example.com',
  role: 'USER',
  active: true,
  createdAt: new Date()
})
console.log('Created user:', john)

// 배치 생성
const newUsers = users.batchInsert([
  { name: 'Alice Smith', email: 'alice@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Bob Wilson', email: 'bob@example.com', role: 'ADMIN', active: true, createdAt: new Date() },
  { name: 'Carol Brown', email: 'carol@example.com', role: 'USER', active: false, createdAt: new Date() }
])
console.log('Batch created:', newUsers.length, 'users')

// =============================================================================
// 4. READ - 데이터 조회
// =============================================================================

console.log('\n=== READ ===')

// ID로 조회
const foundUser = users.findById(john.id)
console.log('Found by ID:', foundUser?.name)

// 전체 조회
const allUsers = users.findAll()
console.log('Total users:', allUsers.length)

// 조건 조회
const activeUsers = users.query()
  .where('active', '=', true)
  .exec()
console.log('Active users:', activeUsers.length)

// 첫 번째 결과
const firstAdmin = users.query()
  .where('role', '=', 'ADMIN')
  .first()
console.log('First admin:', firstAdmin?.name)

// =============================================================================
// 5. UPDATE - 데이터 수정
// =============================================================================

console.log('\n=== UPDATE ===')

// 단일 업데이트
users.update(john.id, { name: 'John Smith' })
const updatedJohn = users.findById(john.id)
console.log('Updated name:', updatedJohn?.name)

// 역할 변경
users.update(john.id, { role: 'ADMIN' })
const adminJohn = users.findById(john.id)
console.log('Updated role:', adminJohn?.role)

// 배치 업데이트
users.batchUpdate([
  { id: newUsers[0].id, data: { active: false } },
  { id: newUsers[1].id, data: { name: 'Robert Wilson' } }
])
console.log('Batch updated 2 users')

// =============================================================================
// 6. DELETE - 데이터 삭제
// =============================================================================

console.log('\n=== DELETE ===')

// 단일 삭제
const beforeDelete = users.findAll().length
users.delete(john.id)
const afterDelete = users.findAll().length
console.log('Deleted 1 user:', beforeDelete, '->', afterDelete)

// 조건부 삭제 (비활성 사용자 삭제)
const inactiveUsers = users.query().where('active', '=', false).exec()
for (const user of inactiveUsers) {
  users.delete(user.id)
}
console.log('Deleted', inactiveUsers.length, 'inactive users')

// =============================================================================
// 7. 최종 상태 확인
// =============================================================================

console.log('\n=== FINAL STATE ===')
const finalUsers = users.findAll()
console.log('Remaining users:', finalUsers.length)
finalUsers.forEach(u => {
  console.log(`  - ${u.name} (${u.role}, active: ${u.active})`)
})
