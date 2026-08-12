# AI Assistant Skills

The `@gsquery/skills` package ships context files so AI coding tools (Claude Code, Cursor, Copilot, etc.) write correct gsquery code -- with the right types, patterns, and anti-patterns.

It is **not** a runtime dependency; it only installs documentation/skill files into your project.

> **Hand-maintained.** These context files are written by hand rather than
> generated from source, so they can lag behind the released packages. Treat them as a head start,
> not as the source of truth — the [API Reference](./api-reference.md) and the installed package's
> type definitions win on any conflict.

## Install

### Claude Code (via openskills -- recommended)

```bash
npx openskills install @gsquery/skills
```

Copies skill files to `.claude/skills/gsquery/` automatically.

### Manual / other tools

```bash
# Claude Code
npx @gsquery/skills install --target claude

# Cursor
npx @gsquery/skills install --target cursor

# Any other tool
npx @gsquery/skills install --target generic
```

## CLI

```bash
# Install skill files (interactive; auto-detects target if --target omitted)
npx @gsquery/skills install [--target claude|cursor|generic] [--dest <path>]

# Show package info
npx @gsquery/skills info
```

### Auto-Detection

| Detected         | Target      | Destination             |
|------------------|-------------|-------------------------|
| `.claude/` exists | Claude Code | `.claude/skills/gsquery/` |
| `.cursor/` exists | Cursor      | `.cursor/rules/`        |
| Otherwise        | Generic     | `.ai/gsquery/`          |

## What's Included

### Claude Code / openskills (6 files)

Installed to `.claude/skills/gsquery/`:

| File | Content |
|------|---------|
| `SKILL.md` | Setup, CRUD quick reference, query operators, anti-patterns |
| `references/crud-and-queries.md` | Full Repository & QueryBuilder API |
| `references/joins-and-aggregation.md` | JoinQueryBuilder, groupBy, agg |
| `references/adapters-and-config.md` | DataStore, MockAdapter, SheetsAdapter, indexes |
| `references/migration-and-cli.md` | MigrationRunner, SchemaBuilder, CLI commands |
| `references/errors.md` | Error hierarchy and handling patterns |

### Generic Format (6 files)

For Cursor (`.cursor/rules/`), Copilot, or any tool (`.ai/gsquery/`):

| File | Content |
|------|---------|
| `gsquery-cheatsheet.md` | Single-file complete reference |
| `gsquery-crud.md` | CRUD operations & queries |
| `gsquery-queries.md` | Joins & aggregation |
| `gsquery-config.md` | Adapters & configuration |
| `gsquery-advanced.md` | Migrations, CLI, client |
| `gsquery-errors.md` | Error handling |

## Programmatic API

The package also exports helpers for building custom installers:

```ts
import {
  getSkillFiles,
  getClaudeSkillFiles,
  getGenericSkillFiles,
  detectTarget,
  getDefaultDest,
  SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  GENERIC_SKILLS_DIR
} from '@gsquery/skills'

const target = detectTarget(process.cwd())   // 'claude' | 'cursor' | 'generic'
const files = getSkillFiles(target)           // SkillFile[]
const dest = getDefaultDest(process.cwd(), target)
```

---

## See Also

- [CLI Reference](./cli-reference.md) -- `gsquery` schema/migration commands
- [Quick Start](./quick-start.md) -- Getting started tutorial
