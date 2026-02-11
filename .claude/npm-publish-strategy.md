# npm Publishing Strategy

## Version Management (Semantic Versioning)

```
MAJOR.MINOR.PATCH[-PRERELEASE]
  1.   2.   3      beta.1
```

### Version Bump Rules

| 변경 유형 | 버전 | 명령어 | 예시 |
|----------|------|--------|------|
| Breaking changes | MAJOR | `pnpm version major` | 1.0.0 → 2.0.0 |
| New features | MINOR | `pnpm version minor` | 1.0.0 → 1.1.0 |
| Bug fixes | PATCH | `pnpm version patch` | 1.0.0 → 1.0.1 |
| Pre-release | PRERELEASE | `pnpm version prerelease` | 1.0.0 → 1.0.1-0 |

## Branch-Based Publishing

### 브랜치별 배포 전략

| 브랜치 | npm tag | 버전 형식 | 자동/수동 | 용도 |
|--------|---------|----------|----------|------|
| `main` | `latest` | `1.0.0` | 수동 | Stable releases |
| `dev` | `next` | `1.1.0-dev.1` | 자동 | Development builds |
| `feature/*` | - | - | 없음 | Feature development |

---

## Release Workflow

### 1. Development Phase (dev branch)

**자동 배포 (CI):**
```yaml
# .github/workflows/publish-dev.yml
on:
  push:
    branches: [dev]

steps:
  - version: 1.0.0-dev.$(git rev-parse --short HEAD)
  - tag: next
  - publish: @gsquery/core@next
```

**설치:**
```bash
npm install @gsquery/core@next
```

---

### 2. Pre-release Phase

#### Alpha (내부 테스트)

```bash
# dev 브랜치에서
pnpm version prerelease --preid=alpha
# 결과: 1.0.0-alpha.0

pnpm publish --tag alpha
```

#### Beta (외부 테스트)

```bash
# dev 브랜치에서
pnpm version prerelease --preid=beta
# 결과: 1.0.0-beta.0

pnpm publish --tag beta
```

#### Release Candidate

```bash
# main에 머지 전
pnpm version prerelease --preid=rc
# 결과: 1.0.0-rc.0

pnpm publish --tag rc
```

---

### 3. Production Release (main branch)

#### Manual Release Process

```bash
# 1. dev → main 머지
git checkout main
git merge dev --no-ff
git push

# 2. 버전 업 (package.json 수정 + git tag 생성)
pnpm version [major|minor|patch]
# 예: pnpm version minor → 1.1.0

# 3. CHANGELOG 자동 생성 (선택)
npx conventional-changelog -p angular -i CHANGELOG.md -s

# 4. 배포
pnpm build
pnpm -r publish --access public --tag latest

# 5. Git push with tags
git push --follow-tags

# 6. GitHub Release 생성
gh release create v1.1.0 --title "v1.1.0" --notes "Release notes..."
```

#### Automated Release (GitHub Actions)

```yaml
# .github/workflows/publish-release.yml
name: Publish Release

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test

      - name: Publish to npm
        run: pnpm -r publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref }}
          release_name: Release ${{ github.ref }}
          draft: false
          prerelease: false
```

---

## npm Tag Management

### Tag Usage

| Tag | 버전 | 설치 방법 | 용도 |
|-----|------|----------|------|
| `latest` | 1.0.0 | `npm install @gsquery/core` | Stable |
| `next` | 1.1.0-dev.abc123 | `npm install @gsquery/core@next` | Dev builds |
| `beta` | 1.0.0-beta.1 | `npm install @gsquery/core@beta` | Public testing |
| `rc` | 1.0.0-rc.1 | `npm install @gsquery/core@rc` | Release candidate |
| `alpha` | 1.0.0-alpha.1 | `npm install @gsquery/core@alpha` | Internal testing |

### Tag 관리 명령어

```bash
# 현재 tag 확인
npm dist-tag ls @gsquery/core

# Tag 추가/변경
npm dist-tag add @gsquery/core@1.0.0 latest
npm dist-tag add @gsquery/core@1.1.0-beta.1 beta

# Tag 제거
npm dist-tag rm @gsquery/core beta
```

---

## Monorepo Publishing

### 전체 패키지 배포

```bash
# 모든 패키지 버전 업
pnpm -r exec pnpm version patch

# 또는 각 패키지 개별 버전 관리
cd packages/core && pnpm version patch
cd packages/cli && pnpm version minor
cd packages/client && pnpm version patch

# 전체 배포
pnpm -r publish --access public
```

### 개별 패키지 배포

```bash
# core만 배포
pnpm --filter @gsquery/core publish --access public

# cli만 배포
pnpm --filter @gsquery/cli publish --access public
```

---

## Release Checklist

### Pre-release

- [ ] All tests passing
- [ ] Coverage > 80%
- [ ] CHANGELOG updated
- [ ] Documentation updated
- [ ] Breaking changes documented
- [ ] Migration guide (if MAJOR)

### Release

- [ ] Merge dev → main
- [ ] Version bump
- [ ] Build successful
- [ ] Publish to npm
- [ ] Create GitHub release
- [ ] Update docs site (if exists)
- [ ] Announce release

### Post-release

- [ ] Verify npm package
- [ ] Test installation
- [ ] Monitor for issues
- [ ] Update dependent projects

---

## Version Lifecycle

```
Development (dev)
    ↓
Alpha (1.0.0-alpha.x)
    ↓
Beta (1.0.0-beta.x)
    ↓
Release Candidate (1.0.0-rc.x)
    ↓
Stable (1.0.0) [main]
    ↓
Patch (1.0.x)
    ↓
Minor (1.x.0)
    ↓
Major (x.0.0)
```

---

## Quick Commands Reference

```bash
# Alpha release
pnpm version prerelease --preid=alpha
pnpm publish --tag alpha

# Beta release
pnpm version prerelease --preid=beta
pnpm publish --tag beta

# RC release
pnpm version prerelease --preid=rc
pnpm publish --tag rc

# Stable release
pnpm version [major|minor|patch]
pnpm -r publish --access public
git push --follow-tags

# Rollback (unpublish within 72 hours)
npm unpublish @gsquery/core@1.0.0-beta.1

# Deprecate version
npm deprecate @gsquery/core@1.0.0 "Please upgrade to 1.1.0"
```

---

## npm Registry Setup

### Authentication

```bash
# Login to npm
npm login

# Set registry (if using private registry)
npm config set registry https://registry.npmjs.org/

# Verify authentication
npm whoami
```

### package.json Configuration

```json
{
  "name": "@gsquery/core",
  "version": "1.0.0",
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

### .npmrc Configuration

```
# .npmrc (root)
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
access=public
```

---

## Security Best Practices

1. **Use npm tokens** (not password) in CI/CD
2. **Enable 2FA** for npm account
3. **Restrict publish permissions** to maintainers only
4. **Audit dependencies** before release: `pnpm audit`
5. **Sign releases** with GPG keys
6. **Review package contents**: `npm pack --dry-run`

---

## Monitoring & Analytics

### After Publishing

```bash
# View package info
npm view @gsquery/core

# Download stats
npm view @gsquery/core dist-tags
npm view @gsquery/core versions

# Check bundle size
npm pack --dry-run
npx bundlephobia @gsquery/core
```

### Tracking

- npm downloads: https://npm-stat.com/charts.html?package=@gsquery/core
- GitHub releases: Track via GitHub Insights
- User feedback: GitHub Issues, Discussions
