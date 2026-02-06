# npm Publishing Guide

## Package.json Setup

```json
{
  "name": "gas-sheets-query",
  "version": "0.1.0",
  "description": "Use Google Sheets as a database with TypeScript",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist"
  ],
  "keywords": [
    "google-sheets",
    "gas",
    "google-apps-script",
    "database",
    "query-builder",
    "typescript"
  ],
  "author": "Juhyeon Lee",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/juhyeonni/gas-sheets-query"
  },
  "bugs": {
    "url": "https://github.com/juhyeonni/gas-sheets-query/issues"
  },
  "homepage": "https://github.com/juhyeonni/gas-sheets-query#readme"
}
```

## Pre-publish Checklist

```bash
# 1. Clean build
rm -rf dist
pnpm build

# 2. Check package contents
npm pack --dry-run

# 3. Test install locally
npm pack
cd /tmp && npm init -y && npm install /path/to/gas-sheets-query-0.1.0.tgz

# 4. Verify types work
echo "import { createSheetsDB } from 'gas-sheets-query'" > test.ts
npx tsc test.ts --noEmit
```

## Publishing

```bash
# First time: login
npm login

# Publish (public)
npm publish --access public

# Publish beta
npm version prerelease --preid=beta
npm publish --tag beta
```

## GitHub Actions CI/CD

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - run: pnpm install
      - run: pnpm test
      - run: pnpm build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Versioning Commands

```bash
# Bump version (updates package.json + creates git tag)
npm version patch  # 0.1.0 -> 0.1.1
npm version minor  # 0.1.0 -> 0.2.0
npm version major  # 0.1.0 -> 1.0.0

# Push with tags
git push --follow-tags
```
