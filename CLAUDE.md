# gas-sheets-query

TypeScript library for using Google Sheets as a database in GAS projects.

## Project Configuration

GitHub settings are stored in `.claude/project.json`.

```bash
cat .claude/project.json
```

## Quick Commands

```bash
# Development
pnpm install        # Install dependencies
pnpm dev            # Watch mode
pnpm build          # Build for production
pnpm test           # Run tests

# GAS deployment
pnpm build:gas      # Bundle for GAS
clasp push          # Push to GAS

# Release
pnpm version patch  # Bump version
npm publish         # Publish to npm
```

## Tech Stack

| Area      | Technology          |
| --------- | ------------------- |
| Language  | TypeScript (strict) |
| Build     | esbuild             |
| Test      | Vitest              |
| Package   | pnpm                |
| Target    | GAS + Node.js       |

## Architecture

```
src/
├── core/
│   ├── repository.ts    # DataStore interface + implementation
│   ├── query-builder.ts # Fluent query API
│   └── types.ts         # Core types
├── adapters/
│   ├── gas-adapter.ts   # Google Sheets adapter
│   └── mock-adapter.ts  # In-memory adapter for testing
├── features/
│   ├── indexing.ts      # Column indexing
│   ├── batch.ts         # Batch operations
│   └── migration.ts     # Schema migrations
└── index.ts             # Public API
```

## Skills Reference

| Skill                | Description                          |
| -------------------- | ------------------------------------ |
| `development-flow`   | GitHub sync and task workflow        |
| `project-management` | Issues, PRs, milestone workflow      |
| `library-dev`        | Library development best practices   |
| `gas-environment`    | GAS runtime, limits, clasp deploy    |

## Core Rules

- **English only**: All comments, docs, and commits in English
- **Type-safe**: Strict TypeScript, no `any`
- **Test-first**: Write tests before implementation
- **Semantic versioning**: Follow semver for releases

## Notifications

Report to Juhyeon via Telegram (8310770897):
- 📝 Issue start: `"📝 Starting #N: {title}"`
- ✅ Issue complete: `"✅ Completed #N: {title}"`
- ❓ Questions: Ask immediately if stuck
