# clasp Workflow

## 초기 설정

```bash
# 1. clasp 설치
npm install -g @google/clasp

# 2. 로그인
clasp login

# 3. 기존 프로젝트 연결
clasp clone <scriptId>

# 또는 새 프로젝트 생성
clasp create --title "My Project" --type sheets
```

## 프로젝트 구조

```
project/
├── src/
│   └── index.ts        # 소스 (TypeScript)
├── dist/
│   ├── index.js        # 빌드 결과
│   └── appsscript.json # GAS 매니페스트
├── .clasp.json
├── tsconfig.json
└── esbuild.config.js
```

## .clasp.json
```json
{
  "scriptId": "1234567890abcdef",
  "rootDir": "dist",
  "fileExtension": "js"
}
```

## appsscript.json
```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  }
}
```

## 빌드 설정 (esbuild)

```javascript
// esbuild.config.js
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'esm',
  target: 'es2020',
  // GAS는 top-level await 미지원
  supported: { 'top-level-await': false },
  // 전역 함수로 노출
  globalName: 'exports',
  footer: {
    js: `
      // GAS 전역 함수 노출
      var doGet = exports.doGet;
      var doPost = exports.doPost;
      var apiGet = exports.apiGet;
      var apiPost = exports.apiPost;
    `
  }
})
```

## package.json 스크립트

```json
{
  "scripts": {
    "build:gas": "node esbuild.config.js && cp appsscript.json dist/",
    "push": "pnpm build:gas && clasp push",
    "deploy": "pnpm push && clasp deploy",
    "logs": "clasp logs --watch",
    "open": "clasp open"
  }
}
```

## 배포 버전 관리

```bash
# 버전 목록
clasp deployments

# 새 배포 생성
clasp deploy -d "v1.0.0 - Initial release"

# 기존 배포 업데이트
clasp deploy -i <deploymentId> -d "v1.0.1 - Bug fix"

# 배포 삭제
clasp undeploy <deploymentId>
```

## 개발 워크플로우

```bash
# 1. 개발 (watch 모드)
pnpm dev

# 2. 테스트 푸시
pnpm push
clasp open  # 브라우저에서 테스트

# 3. 로그 확인
clasp logs --watch

# 4. 프로덕션 배포
pnpm deploy
```

## 트러블슈팅

### "Script not found" 에러
```bash
# scriptId 확인
cat .clasp.json

# 권한 확인 (GAS 에디터에서 공유 설정)
```

### 푸시 충돌
```bash
# 강제 푸시 (로컬 우선)
clasp push --force
```

### 타입 에러
```bash
# GAS 타입 설치
npm install -D @types/google-apps-script
```
