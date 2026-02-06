# gas-sheets-query

> Google Sheets를 데이터베이스처럼 쓸 수 있게 해주는 TypeScript 라이브러리

GAS(Google Apps Script) 앱 개발 시 반복되는 Sheets CRUD + 쿼리 로직을 추상화합니다.

## ✨ 핵심 가치

- 🔌 **Plug & Play** - 설정 최소화, 바로 사용
- 🛡️ **Type-safe** - 스키마 정의 → 자동 타입 추론
- ⚡ **성능** - 필요한 데이터만 조회 (인덱스, 부분 읽기)
- 🔄 **이식성** - GAS + 로컬 개발 환경 모두 지원
- 🧩 **확장성** - JOIN, Aggregation, Migration 지원

## 📦 패키지 구조

```
gas-sheets-query/
├── packages/
│   ├── core/       # 핵심 라이브러리 (SheetsDB, QueryBuilder)
│   └── cli/        # CLI 도구 (gsq)
```

## 🚀 Quick Start

### 1. 설치

```bash
# npm
npm install gas-sheets-query

# pnpm (권장)
pnpm add gas-sheets-query
```

### 2. 스키마 정의

```yaml
# schema.gsq.yaml
tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string
      role: string @default("USER")
      createdAt: datetime @default(now)
```

### 3. 타입 생성

```bash
npx gsq generate
```

### 4. 사용

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

// DB 인스턴스 생성
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'role'] as const,
      types: { id: 0, name: '', email: '', role: '' }
    }
  },
  stores: {
    users: new MockAdapter()  // 테스트용, 실제는 SheetsAdapter 사용
  }
})

// CRUD
const user = db.from('users').create({ name: 'John', email: 'john@example.com', role: 'USER' })
const found = db.from('users').findById(user.id)
db.from('users').update(user.id, { role: 'ADMIN' })
db.from('users').delete(user.id)

// 쿼리
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()
```

## 🛠 CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `gsq init` | 프로젝트 초기화 (gsq.config.json 생성) |
| `gsq generate` | 스키마에서 타입/클라이언트 코드 생성 |
| `gsq migration:create <name>` | 새 마이그레이션 파일 생성 |
| `gsq migrate` | 마이그레이션 실행 |
| `gsq rollback` | 마지막 마이그레이션 롤백 |

```bash
# 초기화
npx gsq init --spreadsheet-id YOUR_SPREADSHEET_ID

# 타입 생성
npx gsq generate

# 마이그레이션
npx gsq migration:create add_users_table
npx gsq migrate
npx gsq rollback
```

## 📚 문서

- [Getting Started](./docs/getting-started.md) - 단계별 시작 가이드
- [API Reference](./docs/api-reference.md) - 상세 API 문서
- [Examples](./docs/examples.md) - 실전 예제
- [Schema Syntax](./docs/schema-syntax.md) - 스키마 문법

## 🎯 주요 기능

### Query Builder

```typescript
// 기본 쿼리
const users = db.from('users')
  .query()
  .where('active', '=', true)
  .where('age', '>', 18)
  .orderBy('name', 'asc')
  .limit(10)
  .exec()

// 편의 메서드
db.from('users').query().whereEq('role', 'ADMIN')
db.from('users').query().whereIn('status', ['ACTIVE', 'PENDING'])
db.from('users').query().whereLike('name', 'John%')
```

### Aggregation

```typescript
// 단일 집계
const count = db.from('orders').query().count()
const total = db.from('orders').query().sum('amount')

// 그룹별 집계
const stats = db.from('orders')
  .query()
  .groupBy('status')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount',
    avgAmount: 'avg:amount'
  })
// [{ status: 'PAID', count: 10, totalAmount: 5000, avgAmount: 500 }, ...]
```

### JOIN

```typescript
const postsWithAuthors = db.from('posts')
  .joinQuery()
  .join('users', 'authorId', 'id', { as: 'author' })
  .where('status', '=', 'PUBLISHED')
  .exec()

// 결과: [{ id, title, author: { id, name, email } }, ...]
```

### Migration

```typescript
// migrations/001_add_users.ts
export const migration = {
  version: 1,
  name: 'add_users_table',
  up: (db) => {
    db.addColumn('users', 'nickname', { default: '' })
  },
  down: (db) => {
    db.removeColumn('users', 'nickname')
  }
}
```

## 🗺 로드맵

- [x] v0.1 - Core (MVP): 기본 CRUD + Query Builder
- [x] v0.5 - Schema Generator: CLI (`gsq generate`), 타입/클라이언트 코드 생성
- [ ] v0.6 - Performance: 최적화, Batch, 인덱싱
- [ ] v0.7 - Advanced Query: Visualization API, JOIN, Aggregation
- [ ] v0.8 - DX: 마이그레이션, 문서화
- [ ] v1.0 - Production: npm 배포, 실사용 검증

## 📝 라이선스

MIT

## 🤝 기여

이슈와 PR을 환영합니다! [Contributing Guide](./CONTRIBUTING.md)를 참고하세요.
