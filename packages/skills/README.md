# @gsquery/skills

AI coding assistant context files for [gas-sheets-query](https://github.com/juhyeonni/gas-sheets-query).

Provides skill/context files so AI tools (Claude Code, Cursor, Copilot, etc.) can write correct gsquery code with proper types, patterns, and anti-patterns.

## Install

### Claude Code (via openskills — recommended)

```bash
npx openskills install @gsquery/skills
```

This copies skill files to `.claude/skills/gsquery/` automatically.

### Claude Code (manual)

```bash
npx @gsquery/skills install --target claude
```

### Cursor

```bash
npx @gsquery/skills install --target cursor
```

### Other Tools

```bash
npx @gsquery/skills install --target generic
```

## What's Included

### Claude Code / openskills (6 files)

Installed to `.claude/skills/gsquery/`:

| File | Content |
|------|---------|
| `SKILL.md` | Setup, CRUD quick reference, query operators, anti-patterns |
| `references/crud-and-queries.md` | Full Repository & QueryBuilder API |
| `references/joins-and-aggregation.md` | JoinQueryBuilder, groupBy, agg |
| `references/adapters-and-config.md` | DataStore, MockAdapter, SheetsAdapter, Indexes |
| `references/migration-and-cli.md` | MigrationRunner, SchemaBuilder, CLI commands |
| `references/errors-and-viz.md` | Error hierarchy, Visualization API |

### Generic Format (6 files)

For Cursor (`.cursor/rules/`), Copilot, or any tool (`.ai/gsquery/`):

| File | Content |
|------|---------|
| `gsquery-cheatsheet.md` | Single-file complete reference |
| `gsquery-crud.md` | CRUD operations & queries |
| `gsquery-queries.md` | Joins & aggregation |
| `gsquery-config.md` | Adapters & configuration |
| `gsquery-advanced.md` | Migrations, CLI, client |
| `gsquery-errors.md` | Error handling & Viz API |

## CLI

```bash
# Install skill files (interactive)
npx @gsquery/skills install [--target claude|cursor|generic] [--dest <path>]

# Show package info
npx @gsquery/skills info
```

### Auto-Detection

| Detected | Target | Destination |
|----------|--------|-------------|
| `.claude/` exists | Claude Code | `.claude/skills/gsquery/` |
| `.cursor/` exists | Cursor | `.cursor/rules/` |
| Otherwise | Generic | `.ai/gsquery/` |

## Programmatic API

```ts
import {
  getSkillFiles,
  getClaudeSkillFiles,
  getGenericSkillFiles,
  detectTarget,
  getDefaultDest,
  SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  GENERIC_SKILLS_DIR,
} from '@gsquery/skills'
```

## License

MIT
