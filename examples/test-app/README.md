# gas-sheets-query 테스트 앱

Google Sheets + Apps Script 환경에서 gas-sheets-query 라이브러리의 전체 기능을 테스트하는 앱입니다.

## 📁 구조

```
test-app/
├── schema.gsq.yaml       # 스키마 정의 (User, Project, Task, Comment)
├── appsscript.json       # GAS 매니페스트
├── src/
│   └── Code.ts           # GAS 진입점 + 테스트 함수들
├── generated/            # gsq generate로 생성되는 파일들
│   ├── types.ts
│   ├── client.ts
│   └── index.ts
└── README.md
```

## 🚀 배포 방법

### 1. clasp 설치 및 로그인

```bash
npm install -g @google/clasp
clasp login
```

### 2. Google Sheets 생성

1. [Google Sheets](https://sheets.google.com)에서 새 스프레드시트 생성
2. 스프레드시트 ID 복사 (URL에서: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`)

### 3. Apps Script 프로젝트 생성

```bash
cd examples/test-app

# 새 GAS 프로젝트 생성
clasp create --type sheets --title "GSQ Test App" --parentId "{SPREADSHEET_ID}"

# 또는 기존 프로젝트에 연결
clasp clone {SCRIPT_ID}
```

### 4. 코드 생성 및 푸시

```bash
# 스키마에서 타입 및 클라이언트 생성
cd ../..
npx gsq generate examples/test-app/schema.gsq.yaml -o examples/test-app/generated

# GAS에 푸시
cd examples/test-app
clasp push
```

### 5. 실행

1. `clasp open`으로 Apps Script 에디터 열기
2. `testConnection` 함수 실행하여 연결 확인
3. `setupTestData` 함수 실행하여 테스트 데이터 생성
4. `runAllTests` 함수 실행하여 전체 테스트 수행

## 📊 스키마 설명

### User
사용자 정보를 저장합니다.
- `id`: 자동 증가 ID
- `email`: 이메일 (유니크)
- `name`: 이름
- `role`: 역할 (ADMIN, MEMBER, GUEST)

### Project
프로젝트 정보를 저장합니다.
- `id`: 자동 증가 ID
- `name`: 프로젝트 이름
- `ownerId`: 소유자 ID (User 참조)
- `status`: 상태 (ACTIVE, ARCHIVED)

### Task
태스크 정보를 저장합니다.
- `id`: 자동 증가 ID
- `title`: 제목
- `projectId`: 프로젝트 ID (Project 참조)
- `assigneeId`: 담당자 ID (User 참조, nullable)
- `status`: 상태 (TODO, IN_PROGRESS, DONE)
- `priority`: 우선순위 (LOW, MEDIUM, HIGH)
- `dueDate`: 마감일 (nullable)

### Comment
댓글 정보를 저장합니다.
- `id`: 자동 증가 ID
- `content`: 내용
- `taskId`: 태스크 ID (Task 참조)
- `authorId`: 작성자 ID (User 참조)
- `createdAt`: 생성일시

## 🧪 테스트 함수

| 함수 | 설명 |
|------|------|
| `testConnection` | 스프레드시트 연결 확인 |
| `setupTestData` | 테스트 데이터 초기화 및 삽입 |
| `testCRUD` | Create, Read, Update, Delete 테스트 |
| `testBatch` | batchInsert, batchUpdate 테스트 |
| `testQuery` | where, orderBy, limit, offset, like, in 테스트 |
| `testJoin` | JOIN 쿼리 테스트 |
| `testAggregation` | count, groupBy, having 테스트 |
| `runAllTests` | 전체 테스트 실행 |

## 📝 메뉴 사용

스프레드시트를 열면 `🧪 GSQ Tests` 메뉴가 추가됩니다.
메뉴에서 각 테스트를 직접 실행할 수 있습니다.

## ⚠️ 주의사항

1. **첫 실행 시 권한 승인 필요**: OAuth 동의 화면이 표시됩니다.
2. **스프레드시트 ID 설정**: `generated/client.ts`에서 SPREADSHEET_ID 확인
3. **쿼터 제한**: GAS 일일 쿼터 (읽기/쓰기 제한) 주의

## 🔧 트러블슈팅

### "Sheet not found" 에러
- 시트가 아직 생성되지 않았습니다. `setupTestData`를 먼저 실행하세요.

### 권한 에러
- 스프레드시트에 대한 편집 권한이 있는지 확인하세요.

### 타입 에러
- `generated/` 폴더가 비어있다면 `gsq generate`를 실행하세요.
