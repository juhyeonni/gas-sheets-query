# API Reference

gas-sheets-query의 전체 API 문서입니다.

## 목차

- [SheetsDB](#sheetsdb)
- [TableHandle](#tablehandle)
- [QueryBuilder](#querybuilder)
- [JoinQueryBuilder](#joinquerybuilder)
- [Aggregation](#aggregation)
- [Migration](#migration)
- [CLI 명령어](#cli-명령어)
- [Errors](#errors)

---

## SheetsDB

### defineSheetsDB

스키마 기반 자동 타입 추론을 사용하는 팩토리 함수입니다. (권장)

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

const db = defineSheetsDB({
  spreadsheetId: 'optional-id',
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: {
        id: 0,          // → number
        name: '',       // → string
        email: '',      // → string
        role: ''        // → string
      }
    }
  },
  stores: {
    users: new MockAdapter()
  }
})
```

#### Options

| 속성 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `spreadsheetId` | `string` | ✗ | Google Spreadsheet ID |
| `tables` | `Record<string, TableSchemaTyped>` | ✓ | 테이블 스키마 정의 |
| `stores` | `Record<string, DataStore>` | ✓ | 각 테이블의 DataStore |

### createSheetsDB

명시적 타입을 사용하는 레거시 팩토리 함수입니다.

```typescript
import { createSheetsDB, MockAdapter } from 'gas-sheets-query'

interface User {
  id: number
  name: string
  email: string
}

const db = createSheetsDB<{ users: User }>({
  config: {
    tables: {
      users: { columns: ['id', 'name', 'email'] }
    }
  },
  stores: {
    users: new MockAdapter()
  }
})
```

### SheetsDB 인터페이스

```typescript
interface SheetsDB<Tables> {
  // 테이블 핸들 가져오기
  from<K extends keyof Tables>(tableName: K): TableHandle<Tables[K]>
  
  // 기본 DataStore 접근
  getStore<K extends keyof Tables>(tableName: K): DataStore<Tables[K]>
  
  // 설정
  readonly config: SheetsDBConfig
}
```

---

## TableHandle

테이블별 CRUD 및 쿼리 작업을 위한 핸들입니다.

### 속성 및 메서드

```typescript
interface TableHandle<T> {
  // Repository 직접 접근
  readonly repo: Repository<T>
  
  // 쿼리 빌더 생성
  query(): QueryBuilder<T>
  
  // JOIN 지원 쿼리 빌더
  joinQuery(): JoinQueryBuilder<T>
  
  // CRUD 단축 메서드
  create(data: Omit<T, 'id'>): T
  findById(id: string | number): T
  findAll(): T[]
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T
  delete(id: string | number): void
  
  // 배치 작업
  batchInsert(data: Omit<T, 'id'>[]): T[]
  batchUpdate(items: { id: string | number; data: Partial<Omit<T, 'id'>> }[]): T[]
}
```

### 예시

```typescript
const users = db.from('users')

// CRUD
const user = users.create({ name: 'John', email: 'john@example.com' })
const found = users.findById(1)
users.update(1, { name: 'John Doe' })
users.delete(1)

// 배치 작업
const newUsers = users.batchInsert([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
])
```

---

## QueryBuilder

fluent 인터페이스로 쿼리를 구성합니다.

### 생성

```typescript
const query = db.from('users').query()
```

### 조건 (Where)

```typescript
// 기본 조건
query.where('field', 'operator', 'value')

// 지원 연산자
query.where('age', '=', 25)     // 같음
query.where('age', '!=', 25)    // 다름
query.where('age', '>', 25)     // 초과
query.where('age', '>=', 25)    // 이상
query.where('age', '<', 25)     // 미만
query.where('age', '<=', 25)    // 이하
query.where('role', 'in', ['ADMIN', 'USER'])  // 포함
query.where('name', 'like', 'John%')  // 패턴 매칭

// 단축 메서드
query.whereEq('role', 'ADMIN')           // where('role', '=', 'ADMIN')
query.whereNot('status', 'DELETED')      // where('status', '!=', 'DELETED')
query.whereIn('role', ['ADMIN', 'USER']) // where('role', 'in', [...])
query.whereLike('name', 'John%')         // where('name', 'like', ...)
```

### 정렬 (OrderBy)

```typescript
query.orderBy('name', 'asc')   // 오름차순
query.orderBy('createdAt', 'desc')  // 내림차순

// 다중 정렬
query
  .orderBy('role', 'asc')
  .orderBy('name', 'asc')
```

### 페이지네이션

```typescript
// limit/offset
query.limit(10)
query.offset(20)

// page (편의 메서드)
query.page(2, 10)  // 2페이지, 10개씩 = offset(10).limit(10)
```

### 실행

```typescript
// 모든 결과
const results: User[] = query.exec()

// 첫 번째 결과
const first: User | undefined = query.first()

// 첫 번째 결과 (없으면 에러)
const firstOrFail: User = query.firstOrFail()  // throws NoResultsError

// 결과 개수
const count: number = query.count()

// 존재 여부
const exists: boolean = query.exists()
```

### 쿼리 빌드

```typescript
// 옵션 객체로 빌드 (실행하지 않음)
const options = query
  .where('role', '=', 'ADMIN')
  .orderBy('name')
  .build()

// clone
const cloned = query.clone()
```

### 전체 예시

```typescript
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .where('active', '=', true)
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

---

## JoinQueryBuilder

JOIN을 지원하는 확장된 QueryBuilder입니다.

### 생성

```typescript
const query = db.from('posts').joinQuery()
```

### JOIN 메서드

```typescript
// 기본 JOIN (left join)
query.join('users', 'authorId', 'id')

// 별칭 지정
query.join('users', 'authorId', 'id', { as: 'author' })

// Left Join (명시적)
query.leftJoin('users', 'authorId', 'id')

// Inner Join (매칭 없으면 제외)
query.innerJoin('users', 'authorId', 'id')
```

### 다중 JOIN

```typescript
const result = db.from('comments')
  .joinQuery()
  .join('posts', 'postId', 'id', { as: 'post' })
  .join('users', 'authorId', 'id', { as: 'author' })
  .exec()

// 결과: { ...comment, post: {...}, author: {...} }
```

### 전체 예시

```typescript
const publishedPosts = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('published', '=', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .exec()

// 결과: [
//   { id: 1, title: '...', author: { id: 1, name: 'John', ... } },
//   ...
// ]
```

---

## Aggregation

### 단일 집계

```typescript
const query = db.from('orders').query()

// 개수
const count = query.count()

// 합계
const total = query.sum('amount')

// 평균
const average = query.avg('amount')

// 최솟값
const min = query.min('amount')

// 최댓값
const max = query.max('amount')
```

### 그룹별 집계

```typescript
// 그룹화
const stats = db.from('orders')
  .query()
  .where('status', '=', 'PAID')
  .groupBy('category')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgAmount: 'avg:amount',
    minAmount: 'min:amount',
    maxAmount: 'max:amount'
  })

// 결과: [
//   { category: 'FOOD', count: 50, totalAmount: 5000, avgAmount: 100, ... },
//   { category: 'DRINKS', count: 30, totalAmount: 1500, avgAmount: 50, ... }
// ]
```

### Having

```typescript
// 그룹 필터링
const bigCategories = db.from('orders')
  .query()
  .groupBy('category')
  .having('count', '>', 10)  // 10개 초과인 그룹만
  .agg({
    count: 'count',
    total: 'sum:amount'
  })
```

### AggSpec 타입

| 스펙 | 설명 |
|------|------|
| `'count'` | 행 개수 |
| `'sum:field'` | 필드 합계 |
| `'avg:field'` | 필드 평균 |
| `'min:field'` | 필드 최솟값 |
| `'max:field'` | 필드 최댓값 |

---

## Migration

### MigrationRunner

```typescript
import { createMigrationRunner, MockAdapter } from 'gas-sheets-query'

const runner = createMigrationRunner({
  migrationsStore: new MockAdapter(),  // 마이그레이션 기록 저장
  storeResolver: (table) => stores[table],
  migrations: [
    {
      version: 1,
      name: 'add_nickname_column',
      up: (db) => {
        db.addColumn('users', 'nickname', { default: '' })
      },
      down: (db) => {
        db.removeColumn('users', 'nickname')
      }
    }
  ]
})
```

### 메서드

```typescript
// 현재 버전 확인
const version = runner.getCurrentVersion()

// 대기 중인 마이그레이션
const pending = runner.getPendingMigrations()

// 마이그레이션 실행
const result = await runner.migrate()
// { applied: [{ version: 1, name: 'add_nickname' }], currentVersion: 1 }

// 특정 버전까지만 실행
await runner.migrate({ to: 3 })

// 롤백
const rollback = await runner.rollback()
// { rolledBack: { version: 1, name: '...' }, currentVersion: 0 }

// 전체 롤백
await runner.rollbackAll()

// 상태 확인
const status = runner.getStatus()
// { currentVersion: 1, applied: [...], pending: [...] }
```

### SchemaBuilder 메서드

```typescript
interface SchemaBuilder {
  // 컬럼 추가
  addColumn(table: string, column: string, options?: {
    default?: unknown
    type?: 'string' | 'number' | 'boolean' | 'date'
  }): void
  
  // 컬럼 삭제
  removeColumn(table: string, column: string): void
  
  // 컬럼 이름 변경
  renameColumn(table: string, oldName: string, newName: string): void
}
```

---

## CLI 명령어

### gsq init

프로젝트를 초기화합니다.

```bash
gsq init [options]

Options:
  -s, --spreadsheet-id <id>   Google Spreadsheet ID
  -f, --force                 기존 설정 덮어쓰기
```

생성되는 `gsq.config.json`:

```json
{
  "spreadsheetId": "YOUR_ID",
  "migrationsDir": "migrations",
  "generatedDir": "generated",
  "schemaFile": "schema.gsq.yaml"
}
```

### gsq generate

스키마에서 타입과 클라이언트를 생성합니다.

```bash
gsq generate [options]

Options:
  -s, --schema <path>     스키마 파일 경로 (기본: schema.gsq.yaml)
  -o, --output <dir>      출력 디렉토리 (기본: generated/)
```

생성되는 파일:
- `generated/types.ts` - 타입 정의
- `generated/client.ts` - DB 클라이언트

### gsq migration:create

새 마이그레이션 파일을 생성합니다.

```bash
gsq migration:create <name>

Examples:
  gsq migration:create add_users_table
  gsq migration:create add_nickname_to_users
```

생성되는 파일:
- `migrations/NNNN_name.ts`

### gsq migrate

대기 중인 마이그레이션을 실행합니다.

```bash
gsq migrate [options]

Options:
  --to <version>    특정 버전까지만 실행
```

### gsq rollback

마지막 마이그레이션을 롤백합니다.

```bash
gsq rollback
```

---

## Errors

### 에러 클래스

| 에러 | 설명 |
|------|------|
| `SheetsQueryError` | 기본 에러 클래스 |
| `TableNotFoundError` | 테이블을 찾을 수 없음 |
| `RowNotFoundError` | 행을 찾을 수 없음 |
| `NoResultsError` | 쿼리 결과가 없음 (`firstOrFail`) |
| `MissingStoreError` | DataStore가 없음 |
| `ValidationError` | 유효성 검사 실패 |
| `InvalidOperatorError` | 잘못된 연산자 |
| `MigrationVersionError` | 마이그레이션 버전 에러 |
| `MigrationExecutionError` | 마이그레이션 실행 실패 |
| `NoMigrationsToRollbackError` | 롤백할 마이그레이션 없음 |

### 예시

```typescript
import { TableNotFoundError, NoResultsError } from 'gas-sheets-query'

try {
  const user = db.from('users')
    .query()
    .whereEq('email', 'unknown@example.com')
    .firstOrFail()
} catch (error) {
  if (error instanceof NoResultsError) {
    console.log('User not found')
  }
}
```

---

## 다음 단계

- [Getting Started](./getting-started.md) - 시작 가이드
- [Examples](./examples.md) - 실전 예제
- [Schema Syntax](./schema-syntax.md) - 스키마 문법
