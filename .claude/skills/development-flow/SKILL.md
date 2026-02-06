---
name: development-flow
description: This skill should be used when the user says "let's start working", "start development", "what should I work on", "check tasks", "fetch todos from github", "show my tasks", or at the beginning of any development session. Provides GitHub Project task sync and workflow management.
---

# Development Flow Guide

GitHub Project task sync with phase-based workflow tracking.

## Project Configuration

**Always read config first:**

```bash
cat .claude/project.json
```

Variables:
- `PROJECT_NUMBER` = `.github.project.number`
- `PROJECT_OWNER` = `.github.project.owner`
- `REPOSITORY` = `.github.repository`

## Task Initialization

When starting a development session:

1. **Read config:** `cat .claude/project.json`
2. **Check session todos** (TaskList internal state)
3. **If empty, fetch from GitHub:**
   ```bash
   gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json
   ```
4. **Select task and create session todo**

See `references/task-init-flow.md` for detailed workflow.

## Task Execution Workflow

### Status Flow

```
Todo -> In Progress -> To Review -> Done
```

### Phase-Based Tracking

Use TaskCreate/TaskUpdate to track phases:

```
- Phase 1: Setup & Context (in_progress)
- Phase 2: Implementation (pending)
- Phase 3: Quality Check (pending)
- Phase 4: Sync & Complete (pending)
```

Mark each phase `in_progress` when starting, `completed` when done.

### Execution Steps

**Phase 1: Setup & Context**
- Read issue details: `gh issue view <number> --repo {REPOSITORY}`
- Understand acceptance criteria
- Identify affected files

**Phase 2: Implementation**
- Follow task plan/AC
- Apply KISS/YAGNI principles
- Add task ID comments for traceability:
  ```typescript
  // See Issue #123
  function newFeature() { ... }
  ```

**Phase 3: Quality Check**
- Run lint: `npm run lint`
- Run type check: `npx tsc --noEmit`
- Verify tests pass

**Phase 4: Sync & Complete**
- Update GitHub issue status
- Close issue when done
- Update session todo

## GitHub Sync Commands

### Fetch Tasks

```bash
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER}
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json
```

### Create Task

```bash
gh issue create --title "Task title" --body "Description" --repo {REPOSITORY}
gh project item-add {PROJECT_NUMBER} --owner {PROJECT_OWNER} --url <issue_url>
```

### Complete Task

```bash
gh issue close <issue_number> --repo {REPOSITORY} --comment "Completed"
```

## Status Mapping

| Session Todo | GitHub Issue | Project Status |
|--------------|--------------|----------------|
| `pending` | Open | Todo |
| `in_progress` | Open | In Progress |
| `completed` | Closed | Done |

## Critical Rules

- **Single task focus:** Work on one task at a time
- **Phase tracking:** Always use TaskCreate/TaskUpdate for phases
- **Quality gates:** Run lint/typecheck before completing
- **Traceability:** Add issue ID comments to new code
- **Sync back:** Always update GitHub when task is done

## Quick Reference

```bash
# Read config
cat .claude/project.json

# Fetch tasks
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER}

# View issue
gh issue view <number> --repo {REPOSITORY}

# Close issue
gh issue close <number> --repo {REPOSITORY}

# Quality checks
npm run lint && npx tsc --noEmit
```

## Flow References

- Task initialization: `references/task-init-flow.md`
- GitHub sync: `references/github-sync.md`
- TDD process: `references/tdd-process.md`
- Bug fix flow: `references/bug-fix-flow.md`
