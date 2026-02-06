# Skill Template Examples

## Example 1: Development Workflow Skill

```yaml
---
name: dev-workflow
description: Development workflow for feature implementation. Use when starting new features or implementing issues.
---

# Development Workflow

## Quick Start

1. Read issue requirements
2. Create branch
3. Implement changes
4. Submit PR

## Detailed Workflow

### Phase 1: Setup
- Fetch latest from main
- Create feature branch

### Phase 2: Implementation
- Follow coding standards
- Write tests

### Phase 3: Review
- Run linter
- Submit PR

## References

- Coding standards: `references/coding-standards.md`
```

## Example 2: Tool Integration Skill

```yaml
---
name: api-client
description: API client usage patterns. Use when making external API calls or handling responses.
---

# API Client Guide

## Quick Reference

```typescript
const response = await api.get('/endpoint');
```

## Error Handling

| Status | Action |
|--------|--------|
| 400 | Validate input |
| 401 | Refresh token |
| 500 | Retry with backoff |

## References

- Full API docs: `references/api-docs.md`
```

## Example 3: Project Convention Skill

```yaml
---
name: code-style
description: Code style and conventions. Use when writing or reviewing code.
---

# Code Style Guide

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Component | PascalCase | `TaskCard` |
| Function | camelCase | `handleClick` |
| Constant | UPPER_SNAKE | `MAX_ITEMS` |

## File Structure

```
src/
├── components/
├── hooks/
└── utils/
```

## References

- Full style guide: `references/style-guide.md`
```
