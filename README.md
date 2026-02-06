# gas-sheets-query

> Google Sheets를 데이터베이스처럼 쓸 수 있게 해주는 TypeScript 라이브러리

GAS 앱 개발 시 반복되는 Sheets CRUD + 쿼리 로직을 추상화합니다.

## 핵심 가치

- 🔌 **Plug & Play** - 설정 최소화, 바로 사용
- 🛡️ **Type-safe** - 스키마 정의 → 자동 타입 추론
- ⚡ **성능** - 필요한 데이터만 조회 (인덱스, 부분 읽기)
- 🔄 **이식성** - GAS + 로컬 개발 환경 모두 지원

## 사용 예시

```typescript
import { createSheetsDB } from 'gas-sheets-query'

// 초기화
const db = createSheetsDB({
  tables: {
    users: { columns: ['id', 'name', 'email', 'role'] },
    posts: { columns: ['id', 'title', 'authorId', 'status'] },
  }
})

// 쿼리
const admins = db.from('users')
  .where('role', '=', 'admin')
  .orderBy('name', 'asc')
  .limit(10)
  .exec()

// CRUD
db.insert('users', { id: 'u1', name: 'John', email: 'john@example.com', role: 'user' })
db.update('users', 'u1', { role: 'admin' })
db.delete('users', 'u1')
```

## 설치

```bash
npm install gas-sheets-query
```

## 로드맵

- [x] v0.1 - Core (MVP): 기본 CRUD + Query Builder
- [ ] v0.2 - Performance: 최적화, Batch, 인덱싱
- [ ] v0.3 - Advanced Query: Visualization API, JOIN, Aggregation
- [ ] v0.4 - DX: 마이그레이션, CLI, 문서화
- [ ] v1.0 - Production: npm 배포, 실사용 검증

## 라이선스

MIT
