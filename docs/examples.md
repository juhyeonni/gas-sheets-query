# Examples

gas-sheets-query 실전 예제 모음입니다.

## 목차

- [기본 CRUD](#기본-crud)
- [Query Builder](#query-builder)
- [JOIN](#join)
- [Aggregation](#aggregation)
- [Migration](#migration)
- [실전 패턴](#실전-패턴)

---

## 기본 CRUD

### 초기 설정

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

// 타입 정의
interface User {
  id: number
  name: string
  email: string
  role: 'USER' | 'ADMIN'
  active: boolean
  createdAt: Date
}

// DB 초기화
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

const users = db.from('users')
```

### Create

```typescript
// 단일 생성
const user = users.create({
  name: 'John Doe',
  email: 'john@example.com',
  role: 'USER',
  active: true,
  createdAt: new Date()
})
console.log(user.id)  // 자동 생성된 ID

// 배치 생성
const newUsers = users.batchInsert([
  { name: 'Alice', email: 'alice@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Bob', email: 'bob@example.com', role: 'USER', active: true, createdAt: new Date() },
  { name: 'Carol', email: 'carol@example.com', role: 'ADMIN', active: true, createdAt: new Date() }
])
```

### Read

```typescript
// ID로 찾기
const user = users.findById(1)

// 전체 조회
const allUsers = users.findAll()

// 쿼리로 조회
const activeUsers = users.query()
  .where('active', '=', true)
  .exec()
```

### Update

```typescript
// 단일 업데이트
users.update(1, { name: 'John Smith' })

// 배치 업데이트
users.batchUpdate([
  { id: 1, data: { role: 'ADMIN' } },
  { id: 2, data: { active: false } }
])
```

### Delete

```typescript
// 단일 삭제
users.delete(1)

// 조건부 삭제 (직접 구현)
const inactiveUsers = users.query().where('active', '=', false).exec()
for (const user of inactiveUsers) {
  users.delete(user.id)
}
```

---

## Query Builder

### 기본 조건

```typescript
// 같음
users.query().where('role', '=', 'ADMIN').exec()

// 다름
users.query().where('role', '!=', 'USER').exec()

// 비교
users.query().where('age', '>', 18).exec()
users.query().where('age', '>=', 21).exec()
users.query().where('age', '<', 65).exec()
users.query().where('age', '<=', 30).exec()

// IN
users.query().where('role', 'in', ['ADMIN', 'MODERATOR']).exec()

// LIKE (패턴 매칭)
users.query().where('name', 'like', 'John%').exec()   // 시작
users.query().where('email', 'like', '%@gmail.com').exec()  // 끝
users.query().where('name', 'like', '%son%').exec()   // 포함
```

### 다중 조건 (AND)

```typescript
// 모든 조건 충족
const result = users.query()
  .where('active', '=', true)
  .where('role', '=', 'ADMIN')
  .where('age', '>', 25)
  .exec()
```

### 정렬

```typescript
// 단일 정렬
users.query()
  .orderBy('name', 'asc')
  .exec()

// 다중 정렬
users.query()
  .orderBy('role', 'asc')
  .orderBy('name', 'asc')
  .exec()
```

### 페이지네이션

```typescript
// limit/offset
const first10 = users.query().limit(10).exec()
const next10 = users.query().offset(10).limit(10).exec()

// page 메서드 (편의)
const page1 = users.query().page(1, 10).exec()  // 1페이지
const page2 = users.query().page(2, 10).exec()  // 2페이지

// 페이지네이션 헬퍼
function paginate(query, pageNum, pageSize) {
  const total = query.clone().count()
  const data = query.page(pageNum, pageSize).exec()
  
  return {
    data,
    pagination: {
      page: pageNum,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  }
}
```

### 결과 처리

```typescript
// 첫 번째 결과
const first = users.query()
  .where('email', '=', 'john@example.com')
  .first()

if (first) {
  console.log('Found:', first.name)
}

// 첫 번째 결과 (없으면 에러)
try {
  const user = users.query()
    .where('email', '=', 'notfound@example.com')
    .firstOrFail()
} catch (error) {
  console.log('User not found')
}

// 존재 여부
const exists = users.query()
  .where('email', '=', 'john@example.com')
  .exists()

// 개수
const count = users.query()
  .where('active', '=', true)
  .count()
```

### 편의 메서드

```typescript
// whereEq (=)
users.query().whereEq('role', 'ADMIN')

// whereNot (!=)
users.query().whereNot('status', 'DELETED')

// whereIn
users.query().whereIn('role', ['ADMIN', 'MODERATOR'])

// whereLike
users.query().whereLike('name', 'John%')
```

---

## JOIN

### 기본 JOIN

```typescript
// 게시글 + 작성자
const posts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id')
  .exec()

// 결과: [
//   { id: 1, title: '...', authorId: 1, users: { id: 1, name: 'John', ... } }
// ]
```

### 별칭 사용

```typescript
const posts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// 결과: [
//   { id: 1, title: '...', author: { id: 1, name: 'John', ... } }
// ]
```

### 다중 JOIN

```typescript
// 댓글 + 게시글 + 작성자
const comments = db.from('comments')
  .joinQuery()
  .join('posts', 'postId', 'id', { as: 'post' })
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// 결과: [
//   { 
//     id: 1, 
//     content: '...', 
//     post: { id: 1, title: '...' },
//     author: { id: 1, name: 'John' }
//   }
// ]
```

### Inner JOIN

```typescript
// 매칭되는 것만 반환
const postsWithAuthors = db.from('posts')
  .joinQuery()
  .innerJoin('users', 'authorId', 'id', { as: 'author' })
  .exec()
```

### JOIN + 조건/정렬

```typescript
const recentPosts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .exec()
```

---

## Aggregation

### 기본 집계

```typescript
// 개수
const userCount = db.from('users').query().count()

// 합계
const totalRevenue = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .sum('amount')

// 평균
const avgOrderAmount = db.from('orders')
  .query()
  .avg('amount')

// 최솟값/최댓값
const minPrice = db.from('products').query().min('price')
const maxPrice = db.from('products').query().max('price')
```

### 그룹별 집계

```typescript
// 카테고리별 통계
const categoryStats = db.from('products')
  .query()
  .groupBy('category')
  .agg({
    productCount: 'count',
    totalStock: 'sum:stock',
    avgPrice: 'avg:price',
    minPrice: 'min:price',
    maxPrice: 'max:price'
  })

// 결과: [
//   { category: 'Electronics', productCount: 50, totalStock: 1000, avgPrice: 500, ... },
//   { category: 'Clothing', productCount: 100, totalStock: 5000, avgPrice: 50, ... }
// ]
```

### 다중 그룹

```typescript
// 연도-월별 매출
const monthlyRevenue = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .groupBy('year', 'month')
  .agg({
    orderCount: 'count',
    revenue: 'sum:amount',
    avgOrder: 'avg:amount'
  })
```

### Having (그룹 필터)

```typescript
// 10개 초과 주문이 있는 카테고리만
const popularCategories = db.from('products')
  .query()
  .groupBy('category')
  .having('orderCount', '>', 10)
  .agg({
    orderCount: 'count',
    revenue: 'sum:amount'
  })
```

---

## Migration

### 마이그레이션 파일

```typescript
// migrations/001_initial.ts
import type { Migration } from 'gas-sheets-query'

export const migration: Migration = {
  version: 1,
  name: 'initial_schema',
  
  up: (db) => {
    // 새 컬럼 추가
    db.addColumn('users', 'nickname', { default: '' })
    db.addColumn('users', 'bio', { default: '' })
  },
  
  down: (db) => {
    // 컬럼 제거
    db.removeColumn('users', 'nickname')
    db.removeColumn('users', 'bio')
  }
}
```

### 컬럼 이름 변경

```typescript
// migrations/002_rename_column.ts
export const migration: Migration = {
  version: 2,
  name: 'rename_nickname_to_displayName',
  
  up: (db) => {
    db.renameColumn('users', 'nickname', 'displayName')
  },
  
  down: (db) => {
    db.renameColumn('users', 'displayName', 'nickname')
  }
}
```

### 마이그레이션 실행

```typescript
import { createMigrationRunner, MockAdapter } from 'gas-sheets-query'
import { migration as m1 } from './migrations/001_initial'
import { migration as m2 } from './migrations/002_rename_column'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),
  storeResolver: (table) => stores[table],
  migrations: [m1, m2]
})

// 상태 확인
console.log('Current version:', runner.getCurrentVersion())
console.log('Pending:', runner.getPendingMigrations())

// 실행
const result = await runner.migrate()
console.log('Applied:', result.applied)

// 롤백
const rollback = await runner.rollback()
console.log('Rolled back:', rollback.rolledBack)
```

---

## 실전 패턴

### Repository 패턴

```typescript
class UserRepository {
  constructor(private db: SheetsDB) {}
  
  findByEmail(email: string) {
    return this.db.from('users')
      .query()
      .whereEq('email', email)
      .first()
  }
  
  findActiveAdmins() {
    return this.db.from('users')
      .query()
      .whereEq('role', 'ADMIN')
      .whereEq('active', true)
      .orderBy('name', 'asc')
      .exec()
  }
  
  search(query: string, page: number, pageSize: number) {
    const baseQuery = this.db.from('users')
      .query()
      .whereLike('name', `%${query}%`)
    
    return {
      data: baseQuery.clone().page(page, pageSize).exec(),
      total: baseQuery.count()
    }
  }
}
```

### 트랜잭션 패턴

```typescript
// 의사 트랜잭션 (롤백 지원 없음)
async function createOrderWithItems(order: Order, items: OrderItem[]) {
  // 1. 주문 생성
  const created = db.from('orders').create(order)
  
  try {
    // 2. 주문 항목 생성
    const orderItems = items.map(item => ({
      ...item,
      orderId: created.id
    }))
    db.from('orderItems').batchInsert(orderItems)
    
    // 3. 재고 업데이트
    for (const item of items) {
      const product = db.from('products').findById(item.productId)
      db.from('products').update(item.productId, {
        stock: product.stock - item.quantity
      })
    }
    
    return created
  } catch (error) {
    // 실패 시 주문 삭제
    db.from('orders').delete(created.id)
    throw error
  }
}
```

### Soft Delete

```typescript
// deletedAt 컬럼 사용
class SoftDeleteRepository<T extends { id: number; deletedAt: Date | null }> {
  constructor(
    private table: TableHandle<T>
  ) {}
  
  findAll() {
    return this.table.query()
      .where('deletedAt', '=', null)
      .exec()
  }
  
  delete(id: number) {
    this.table.update(id, { deletedAt: new Date() } as Partial<T>)
  }
  
  restore(id: number) {
    this.table.update(id, { deletedAt: null } as Partial<T>)
  }
  
  forceDelete(id: number) {
    this.table.delete(id)
  }
  
  findWithDeleted() {
    return this.table.findAll()
  }
}
```

### 감사 로그

```typescript
function createAuditedTable<T extends { id: number }>(table: TableHandle<T>) {
  const auditLogs = db.from('auditLogs')
  
  return {
    create(data: Omit<T, 'id'>, userId: number) {
      const created = table.create(data)
      auditLogs.create({
        action: 'CREATE',
        tableName: 'users',
        recordId: created.id,
        userId,
        data: JSON.stringify(data),
        createdAt: new Date()
      })
      return created
    },
    
    update(id: number, data: Partial<T>, userId: number) {
      const before = table.findById(id)
      const updated = table.update(id, data)
      auditLogs.create({
        action: 'UPDATE',
        tableName: 'users',
        recordId: id,
        userId,
        dataBefore: JSON.stringify(before),
        dataAfter: JSON.stringify(updated),
        createdAt: new Date()
      })
      return updated
    },
    
    delete(id: number, userId: number) {
      const before = table.findById(id)
      table.delete(id)
      auditLogs.create({
        action: 'DELETE',
        tableName: 'users',
        recordId: id,
        userId,
        data: JSON.stringify(before),
        createdAt: new Date()
      })
    }
  }
}
```

---

## 다음 단계

- [Getting Started](./getting-started.md) - 시작 가이드
- [API Reference](./api-reference.md) - 상세 API 문서
- [Schema Syntax](./schema-syntax.md) - 스키마 문법
