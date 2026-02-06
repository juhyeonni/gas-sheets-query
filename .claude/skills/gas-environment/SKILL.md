# GAS Environment Skill

Google Apps Script 환경의 특성과 제약사항, 최적화 가이드.

## Runtime Limits

| 제한 | 값 | 대응 |
|------|-----|------|
| 실행 시간 | 6분 (트리거: 30분) | 청크 처리, 연속 실행 |
| 메모리 | ~1GB | 대용량 데이터 스트리밍 |
| URL Fetch | 100MB/호출 | 페이지네이션 |
| 스프레드시트 셀 | 1000만 개/파일 | 분할 저장 |
| 동시 실행 | 30/사용자 | 큐잉, 지수 백오프 |

## Sheets API 최적화

### ❌ Bad: 셀 하나씩 접근
```typescript
// N번의 API 호출 - 매우 느림
for (let i = 0; i < 100; i++) {
  sheet.getRange(i, 1).setValue(data[i])
}
```

### ✅ Good: 범위로 한 번에
```typescript
// 1번의 API 호출
sheet.getRange(1, 1, 100, 1).setValues(data.map(d => [d]))
```

### ✅ Better: 배치 + 플러시
```typescript
// 여러 작업 후 한 번에 적용
const values = []
for (const item of items) {
  values.push([item.id, item.name, item.value])
}
sheet.getRange(1, 1, values.length, 3).setValues(values)
SpreadsheetApp.flush()  // 강제 적용
```

## 읽기 최적화

### 필요한 범위만 읽기
```typescript
// ❌ 전체 시트 (빈 셀 포함)
sheet.getDataRange().getValues()

// ✅ 데이터 있는 영역만
const lastRow = sheet.getLastRow()
const lastCol = sheet.getLastColumn()
sheet.getRange(1, 1, lastRow, lastCol).getValues()

// ✅✅ 특정 열만
sheet.getRange("A:C").getValues()  // A~C 열만
```

### 캐싱
```typescript
// CacheService 활용 (최대 6시간)
const cache = CacheService.getScriptCache()

function getDataCached(key: string) {
  const cached = cache.get(key)
  if (cached) return JSON.parse(cached)
  
  const data = fetchExpensiveData()
  cache.put(key, JSON.stringify(data), 21600)  // 6시간
  return data
}
```

## 에러 핸들링

### 재시도 패턴
```typescript
function withRetry<T>(fn: () => T, maxRetries = 3): T {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn()
    } catch (e) {
      if (i === maxRetries - 1) throw e
      Utilities.sleep(1000 * Math.pow(2, i))  // 지수 백오프
    }
  }
  throw new Error('Unreachable')
}

// 사용
const data = withRetry(() => sheet.getDataRange().getValues())
```

### Lock으로 동시성 제어
```typescript
function updateWithLock(fn: () => void) {
  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(30000)  // 30초 대기
    fn()
  } finally {
    lock.releaseLock()
  }
}
```

## clasp 배포

### 프로젝트 구조
```
project/
├── src/           # TypeScript 소스
├── dist/          # 빌드 결과 (GAS용)
├── .clasp.json    # clasp 설정
└── appsscript.json
```

### .clasp.json
```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

### 배포 명령어
```bash
# 빌드 후 푸시
pnpm build:gas
clasp push

# 배포 (버전 생성)
clasp deploy -d "v1.0.0"

# 로그 확인
clasp logs
```

## 디버깅

### console.log vs Logger
```typescript
// 둘 다 Stackdriver에 기록
console.log('Debug:', data)     // 추천 (표준)
Logger.log('Debug: %s', data)   // GAS 전용

// 실행 로그 확인
// GAS 에디터 > 실행 > 실행 로그
// 또는: clasp logs
```

### 에러 스택 추적
```typescript
function main() {
  try {
    riskyOperation()
  } catch (e) {
    console.error('Error:', e.message)
    console.error('Stack:', e.stack)
    throw e  // 다시 던져서 실행 실패로 표시
  }
}
```

## 환경 분기

### GAS vs Node.js
```typescript
// 환경 감지
const isGAS = typeof ScriptApp !== 'undefined'

// 어댑터 선택
const adapter = isGAS 
  ? new GasAdapter() 
  : new MockAdapter()
```

### Properties로 설정 관리
```typescript
// 스크립트 속성 (배포 시 설정)
const props = PropertiesService.getScriptProperties()
const spreadsheetId = props.getProperty('SPREADSHEET_ID')

// 사용자 속성 (사용자별)
const userProps = PropertiesService.getUserProperties()
```

## References

- [references/clasp-workflow.md](references/clasp-workflow.md) - clasp 상세 워크플로우
- [references/quotas.md](references/quotas.md) - GAS 할당량 상세
