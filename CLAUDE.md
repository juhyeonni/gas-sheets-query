# gas-sheets-query

TypeScript library for using Google Sheets as a database in GAS projects.

## Skills (Required Reading)

**Before starting any work, read the relevant skill:**

| When | Skill | Path |
|------|-------|------|
| Starting a task / GitHub sync | `development-flow` | `.claude/skills/development-flow/SKILL.md` |
| Working on issues/PRs | `project-management` | `.claude/skills/project-management/SKILL.md` |
| Designing APIs / Publishing | `library-dev` | `.claude/skills/library-dev/SKILL.md` |
| GAS-specific code / Deploy | `gas-environment` | `.claude/skills/gas-environment/SKILL.md` |
| Creating new skills | `skill-creator` | `.claude/skills/skill-creator/SKILL.md` |

### Skill Triggers

- **"let's start working"** → Read `development-flow`, sync GitHub issues
- **Creating/updating issues** → Read `project-management`
- **Designing public API** → Read `library-dev`
- **Sheets optimization / clasp** → Read `gas-environment`

## Project Configuration

```bash
cat .claude/project.json
```

## Workflow

### 1. Start Session
```
1. Read this CLAUDE.md
2. Check GitHub issues: gh issue list -R juhyeonni/gas-sheets-query
3. Pick an issue from current milestone
4. Read relevant skills for the task
5. Start working
```

### 2. During Development
```
1. Write tests first (TDD)
2. Implement feature
3. Run tests: pnpm test
4. Commit with conventional commits
```

### 3. Complete Task
```
1. Push changes
2. Close issue: gh issue close <number>
3. Notify: "✅ Completed #N: {title}"
```

## Quick Commands

```bash
# Development
pnpm install        # Install dependencies
pnpm dev            # Watch mode
pnpm build          # Build for production
pnpm test           # Run tests

# GAS deployment (see gas-environment skill)
pnpm build:gas      # Bundle for GAS
clasp push          # Push to GAS

# Release (see library-dev skill)
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

## Core Rules

1. **English only** - All comments, docs, and commits in English
2. **Type-safe** - Strict TypeScript, no `any`
3. **Test-first** - Write tests before implementation
4. **Semantic versioning** - Follow semver for releases
5. **Read skills** - Always check relevant skill before major work

## Milestones

| Version | Focus | Key Issues |
|---------|-------|------------|
| v0.1 | Core MVP | #1-4: Setup, Repository, Query Builder, API |
| v0.2 | Performance | #5-7: Optimization, Batch, Indexing |
| v0.3 | Advanced | #8-10: Viz API, JOIN, Aggregation |
| v0.4 | DX | #11-13: Migration, CLI, Docs |
| v1.0 | Production | #14-16: npm, Integration, Release |

## Notifications

Report to Juhyeon via Telegram (8310770897):

```
📝 Starting #N: {title}
✅ Completed #N: {title}
❓ Question: {question}
```

## References

- GitHub: https://github.com/juhyeonni/gas-sheets-query
- Issues: `gh issue list -R juhyeonni/gas-sheets-query`
- Milestones: `gh api repos/juhyeonni/gas-sheets-query/milestones`
