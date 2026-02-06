# GSQ Schema Syntax

GSQ 스키마는 YAML 형식으로 데이터베이스 구조를 정의합니다.

## 기본 구조

```yaml
# schema.gsq.yaml

enums:
  # enum 정의

tables:
  # 테이블 정의
```

## 타입

### 기본 타입

| 타입 | TypeScript | 설명 |
|------|------------|------|
| `string` | `string` | 문자열 |
| `number` | `number` | 숫자 (정수, 소수) |
| `boolean` | `boolean` | 불린 (true/false) |
| `datetime` | `Date` | 날짜/시간 |

### Optional 타입

타입 뒤에 `?`를 붙이면 optional이 됩니다.

```yaml
name: string?    # string | undefined
age: number?     # number | undefined
```

### Enum 타입

`enums` 섹션에서 정의한 이름을 사용합니다.

```yaml
enums:
  Role:
    - USER
    - ADMIN
    - MODERATOR

tables:
  User:
    role: Role    # 'USER' | 'ADMIN' | 'MODERATOR'
```

## 필드 정의

```yaml
tables:
  TableName:
    fieldName: type @attribute1 @attribute2(arg)
```

### 예시

```yaml
tables:
  User:
    id: number @id @default(autoincrement)
    email: string @unique
    name: string?
    age: number @default(0)
    active: boolean @default(true)
    createdAt: datetime @default(now)
```

## 필드 속성 (Attributes)

### @id

필드를 기본키로 지정합니다. 테이블당 하나만 가능합니다.

```yaml
id: number @id
```

### @default(value)

기본값을 지정합니다.

| 값 | 설명 |
|----|------|
| `autoincrement` | 자동 증가 (number 전용) |
| `now` | 현재 시간 (datetime 전용) |
| `true` / `false` | 불린 값 |
| `0`, `100` | 숫자 값 |
| `"text"` | 문자열 값 |
| `EnumValue` | Enum 값 |

```yaml
id: number @default(autoincrement)
count: number @default(0)
active: boolean @default(true)
role: Role @default(USER)
createdAt: datetime @default(now)
```

### @unique

필드 값이 유니크해야 함을 지정합니다.

```yaml
email: string @unique
```

### @updatedAt

레코드 수정 시 자동으로 현재 시간으로 업데이트됩니다.

```yaml
updatedAt: datetime @updatedAt
```

## 블록 속성 (Block Attributes)

테이블 레벨에서 적용되는 속성입니다. `@@`로 시작합니다.

### @@index([fields])

인덱스를 생성합니다.

```yaml
tables:
  Post:
    title: string
    authorId: number
    
    @@index([title])
    @@index([authorId, title])
```

### @@unique([fields])

복합 유니크 제약을 생성합니다.

```yaml
tables:
  Post:
    authorId: number
    slug: string
    
    @@unique([authorId, slug])
```

## 전체 예시

```yaml
# schema.gsq.yaml

enums:
  Role:
    - USER
    - ADMIN

  Status:
    - DRAFT
    - PUBLISHED
    - ARCHIVED

tables:
  User:
    id: number @id @default(autoincrement)
    email: string @unique
    name: string?
    role: Role @default(USER)
    createdAt: datetime @default(now)
    updatedAt: datetime @updatedAt

  Post:
    id: number @id @default(autoincrement)
    title: string
    content: string?
    status: Status @default(DRAFT)
    authorId: number
    createdAt: datetime @default(now)
    updatedAt: datetime @updatedAt

    @@index([authorId])
    @@unique([authorId, title])

  Comment:
    id: number @id @default(autoincrement)
    content: string
    postId: number
    authorId: number
    createdAt: datetime @default(now)

    @@index([postId])
    @@index([authorId])
```

## 생성 결과

위 스키마에서 생성되는 TypeScript:

```typescript
// generated/types.ts

export type Role = 'USER' | 'ADMIN'
export type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface User {
  id: number
  email: string
  name?: string
  role: Role
  createdAt: Date
  updatedAt: Date
}

export interface Post {
  id: number
  title: string
  content?: string
  status: Status
  authorId: number
  createdAt: Date
  updatedAt: Date
}

export interface Comment {
  id: number
  content: string
  postId: number
  authorId: number
  createdAt: Date
}
```
