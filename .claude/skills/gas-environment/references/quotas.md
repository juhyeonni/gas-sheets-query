# GAS Quotas & Limits

## 실행 시간

| 트리거 타입 | 제한 |
|-------------|------|
| 일반 실행 | 6분 |
| 간단한 트리거 (onEdit 등) | 30초 |
| 시간 기반 트리거 | 6분 |
| 웹앱 요청 | 6분 |

### 대응: 청크 처리
```typescript
function processLargeData() {
  const props = PropertiesService.getScriptProperties()
  const startIndex = parseInt(props.getProperty('PROCESS_INDEX') || '0')
  const CHUNK_SIZE = 500
  
  const data = getAllData()
  const chunk = data.slice(startIndex, startIndex + CHUNK_SIZE)
  
  processChunk(chunk)
  
  if (startIndex + CHUNK_SIZE < data.length) {
    // 다음 청크를 위해 트리거 설정
    props.setProperty('PROCESS_INDEX', String(startIndex + CHUNK_SIZE))
    ScriptApp.newTrigger('processLargeData')
      .timeBased()
      .after(1000)
      .create()
  } else {
    props.deleteProperty('PROCESS_INDEX')
  }
}
```

## 일일 할당량 (무료 계정)

| 서비스 | 할당량/일 |
|--------|-----------|
| 스크립트 실행 시간 | 90분 |
| URL Fetch 호출 | 20,000 |
| 이메일 발송 | 100 |
| 스프레드시트 읽기/쓰기 | 무제한* |
| Properties 읽기/쓰기 | 50,000 |
| Cache 읽기/쓰기 | 무제한* |
| 트리거 실행 | 무제한* |

*실질적 제한은 실행 시간에 의해 결정

## 크기 제한

| 항목 | 제한 |
|------|------|
| 스크립트 파일 크기 | 없음 |
| 단일 값 크기 | 50KB (Properties/Cache) |
| URL Fetch 응답 | 50MB |
| 이메일 첨부 | 25MB |
| 스프레드시트 셀 수 | 1000만 개/파일 |
| 스프레드시트 파일 크기 | 100MB |

### 대응: 큰 데이터 분할
```typescript
function storeLargeData(key: string, data: object) {
  const json = JSON.stringify(data)
  const CHUNK_SIZE = 40000  // 50KB 미만으로
  
  const chunks = []
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE))
  }
  
  const props = PropertiesService.getScriptProperties()
  props.setProperty(`${key}_count`, String(chunks.length))
  chunks.forEach((chunk, i) => {
    props.setProperty(`${key}_${i}`, chunk)
  })
}

function loadLargeData(key: string): object {
  const props = PropertiesService.getScriptProperties()
  const count = parseInt(props.getProperty(`${key}_count`) || '0')
  
  let json = ''
  for (let i = 0; i < count; i++) {
    json += props.getProperty(`${key}_${i}`)
  }
  
  return JSON.parse(json)
}
```

## 동시성 제한

| 항목 | 제한 |
|------|------|
| 동시 실행 | 30/사용자 |
| 트리거 동시 실행 | 1 (같은 트리거) |

### 대응: Lock 사용
```typescript
function criticalSection() {
  const lock = LockService.getScriptLock()
  
  if (!lock.tryLock(10000)) {
    throw new Error('Could not obtain lock')
  }
  
  try {
    // 크리티컬 섹션 코드
    updateSharedResource()
  } finally {
    lock.releaseLock()
  }
}
```

## Workspace 계정 추가 할당량

| 항목 | 무료 | Workspace |
|------|------|-----------|
| 실행 시간/일 | 90분 | 6시간 |
| 이메일/일 | 100 | 1,500 |
| 캘린더 이벤트 생성/일 | 5,000 | 10,000 |

## 모니터링

```typescript
// 남은 실행 시간 확인
const remaining = ScriptApp.getService().getRemainingDailyQuota()
console.log('Remaining quota:', remaining)

// 실행 시작 시간 기록
const startTime = new Date()

// 주기적으로 확인
function checkTimeout() {
  const elapsed = new Date().getTime() - startTime.getTime()
  if (elapsed > 5 * 60 * 1000) {  // 5분
    throw new Error('Approaching timeout, saving state...')
  }
}
```
