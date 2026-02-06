# Basic CRUD Example

gas-sheets-query를 사용한 기본 CRUD (Create, Read, Update, Delete) 작업 예제입니다.

## 실행

```bash
npx tsx examples/basic-crud/index.ts
```

## 주요 내용

### 1. DB 초기화

```typescript
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role', 'active', 'createdAt'] as const,
      types: { id: 0, name: '', email: '', role: 'USER', active: true, createdAt: new Date() }
    }
  },
  stores: {
    users: new MockAdapter<User>()
  }
})
```

### 2. CREATE

```typescript
// 단일 생성
const user = users.create({ name: 'John', email: 'john@example.com', ... })

// 배치 생성
const newUsers = users.batchInsert([...])
```

### 3. READ

```typescript
// ID로 조회
const user = users.findById(1)

// 전체 조회
const all = users.findAll()

// 조건 조회
const active = users.query().where('active', '=', true).exec()
```

### 4. UPDATE

```typescript
// 단일 업데이트
users.update(1, { name: 'New Name' })

// 배치 업데이트
users.batchUpdate([{ id: 1, data: { ... } }, ...])
```

### 5. DELETE

```typescript
// 단일 삭제
users.delete(1)
```

## 출력 예시

```
=== CREATE ===
Created user: { id: 1, name: 'John Doe', ... }
Batch created: 3 users

=== READ ===
Found by ID: John Doe
Total users: 4
Active users: 3
First admin: Bob Wilson

=== UPDATE ===
Updated name: John Smith
Updated role: ADMIN
Batch updated 2 users

=== DELETE ===
Deleted 1 user: 4 -> 3
Deleted 2 inactive users

=== FINAL STATE ===
Remaining users: 1
  - Robert Wilson (ADMIN, active: true)
```
