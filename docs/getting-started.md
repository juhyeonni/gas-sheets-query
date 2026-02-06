# Getting Started

gas-sheets-query를 사용한 프로젝트 설정 가이드입니다.

## 목차

1. [설치](#설치)
2. [프로젝트 초기화](#프로젝트-초기화)
3. [스키마 정의](#스키마-정의)
4. [타입 생성](#타입-생성)
5. [DB 연결](#db-연결)
6. [기본 사용법](#기본-사용법)

---

## 설치

### Node.js 요구사항

- Node.js 18 이상
- pnpm (권장) 또는 npm

### 패키지 설치

```bash
# pnpm (권장)
pnpm add gas-sheets-query

# npm
npm install gas-sheets-query

# yarn
yarn add gas-sheets-query
```

---

## 프로젝트 초기화

### 1. CLI로 설정 파일 생성

```bash
npx gsq init --spreadsheet-id YOUR_SPREADSHEET_ID
```

이 명령은 `gsq.config.json` 파일을 생성합니다:

```json
{
  "spreadsheetId": "YOUR_SPREADSHEET_ID",
  "migrationsDir": "migrations",
  "generatedDir": "generated",
  "schemaFile": "schema.gsq.yaml"
}
```

### 2. 옵션

| 옵션 | 설명 |
|------|------|
| `-s, --spreadsheet-id <id>` | Google Spreadsheet ID |
| `-f, --force` | 기존 설정 파일 덮어쓰기 |

### 3. Spreadsheet ID 찾기

Google Sheets URL에서 ID를 찾을 수 있습니다:

```
https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
```

---

## 스키마 정의

### 1. 스키마 파일 생성

프로젝트 루트에 `schema.gsq.yaml` 파일을 생성합니다:

```yaml
# schema.gsq.yaml

enums:
  Role:
    - USER
    - ADMIN
    - MODERATOR

  Status:
    - ACTIVE
    - INACTIVE
    - PENDING

tables:
  User:
    fields:
      id: number @id @default(autoincrement)
      email: string @unique
      name: string
      nickname: string?
      role: Role @default(USER)
      status: Status @default(ACTIVE)
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt

  Post:
    fields:
      id: number @id @default(autoincrement)
      title: string
      content: string?
      authorId: number
      published: boolean @default(false)
      createdAt: datetime @default(now)
    indexes:
      - [authorId]
```

### 2. 스키마 문법

#### 타입

| 타입 | TypeScript | 설명 |
|------|------------|------|
| `string` | `string` | 문자열 |
| `number` | `number` | 숫자 |
| `boolean` | `boolean` | 불린 |
| `datetime` | `Date` | 날짜/시간 |

#### Optional 타입

```yaml
nickname: string?    # string | undefined
```

#### 속성 (Attributes)

| 속성 | 설명 |
|------|------|
| `@id` | 기본키 지정 |
| `@unique` | 유니크 제약 |
| `@default(value)` | 기본값 |
| `@updatedAt` | 자동 업데이트 시간 |

#### 기본값 예시

```yaml
id: number @default(autoincrement)     # 자동 증가
active: boolean @default(true)          # 불린
count: number @default(0)               # 숫자
role: Role @default(USER)               # Enum
createdAt: datetime @default(now)       # 현재 시간
```

자세한 문법은 [Schema Syntax](./schema-syntax.md)를 참고하세요.

---

## 타입 생성

### 1. 타입 생성 명령

```bash
npx gsq generate
```

### 2. 생성 결과

`generated/` 폴더에 파일이 생성됩니다:

```
generated/
├── types.ts      # 타입 정의
└── client.ts     # 타입이 적용된 DB 클라이언트
```

#### types.ts

```typescript
export type Role = 'USER' | 'ADMIN' | 'MODERATOR'
export type Status = 'ACTIVE' | 'INACTIVE' | 'PENDING'

export interface User {
  id: number
  email: string
  name: string
  nickname?: string
  role: Role
  status: Status
  createdAt: Date
  updatedAt: Date
}

export interface Post {
  id: number
  title: string
  content?: string
  authorId: number
  published: boolean
  createdAt: Date
}
```

---

## DB 연결

### 로컬 개발 (MockAdapter)

테스트 및 로컬 개발 시에는 `MockAdapter`를 사용합니다:

```typescript
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'
import type { User, Post } from './generated/types'

const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'email', 'name', 'role', 'createdAt'] as const,
      types: { id: 0, email: '', name: '', role: '', createdAt: new Date() }
    },
    posts: {
      columns: ['id', 'title', 'content', 'authorId', 'published', 'createdAt'] as const,
      types: { id: 0, title: '', content: '', authorId: 0, published: false, createdAt: new Date() }
    }
  },
  stores: {
    users: new MockAdapter<User>(),
    posts: new MockAdapter<Post>()
  }
})
```

### GAS 환경 (SheetsAdapter)

실제 Google Sheets와 연결할 때는 SheetsAdapter를 사용합니다:

```typescript
// GAS 환경에서 실행
import { createSheetsDB, SheetsAdapter } from 'gas-sheets-query'

const spreadsheet = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID')

const db = createSheetsDB({
  config: {
    spreadsheetId: 'YOUR_SPREADSHEET_ID',
    tables: {
      users: { columns: ['id', 'email', 'name', 'role'] },
      posts: { columns: ['id', 'title', 'authorId'] }
    }
  },
  stores: {
    users: new SheetsAdapter(spreadsheet.getSheetByName('users')),
    posts: new SheetsAdapter(spreadsheet.getSheetByName('posts'))
  }
})
```

---

## 기본 사용법

### CRUD 작업

```typescript
// Create
const user = db.from('users').create({
  email: 'john@example.com',
  name: 'John Doe',
  role: 'USER'
})

// Read
const found = db.from('users').findById(user.id)
const all = db.from('users').findAll()

// Update
db.from('users').update(user.id, { name: 'John Smith' })

// Delete
db.from('users').delete(user.id)
```

### 쿼리

```typescript
// 조건 검색
const admins = db.from('users')
  .query()
  .where('role', '=', 'ADMIN')
  .orderBy('name', 'asc')
  .exec()

// 페이지네이션
const page2 = db.from('users')
  .query()
  .page(2, 10)  // 2페이지, 10개씩
  .exec()

// 첫 번째 결과
const first = db.from('users')
  .query()
  .where('email', '=', 'john@example.com')
  .first()
```

---

## 다음 단계

- [API Reference](./api-reference.md) - 상세 API 문서
- [Examples](./examples.md) - 실전 예제
- [Schema Syntax](./schema-syntax.md) - 스키마 문법 상세
