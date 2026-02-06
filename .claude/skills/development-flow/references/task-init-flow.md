# Task Initialization Flow

## Overview

Before starting any development work, follow this flow to identify and track tasks.

```
Session Start
    |
    v
Read .claude/project.json
    |
    v
Check Session Todos (TaskList)
    |
    +-- Has todos? --> Continue with existing todos
    |
    +-- Empty? --> Fetch from GitHub Project
                        |
                        v
                   Select task from list
                        |
                        v
                   Create session todos (phases)
                        |
                        v
                   Start Phase 1
```

## Step 0: Read Project Config

**Always start by reading the project configuration:**

```bash
cat .claude/project.json
```

Extract these values:
- `PROJECT_NUMBER` from `.github.project.number`
- `PROJECT_OWNER` from `.github.project.owner`
- `REPOSITORY` from `.github.repository`

## Step 1: Check Session Todos

Use TaskList to check existing session todos.

If there are existing todos, continue working on them.

## Step 2: Fetch from GitHub Project

```bash
# List all project items
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER}

# Filter by status (optional)
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json | jq '.items[] | select(.status == "Todo")'
```

### Project Item Fields

| Field  | Description         |
| ------ | ------------------- |
| Type   | Issue / PullRequest |
| Title  | Task title          |
| Number | Issue/PR number     |
| Repo   | Repository name     |
| ID     | Project item ID     |

## Step 3: Select Task and Create Phase Todos

After identifying the task:

1. Read issue details: `gh issue view <number> --repo {REPOSITORY}`
2. Create phase-based todos using TaskCreate:

```
- Phase 1: Setup & Context
- Phase 2: Implementation
- Phase 3: Quality Check
- Phase 4: Sync & Complete
```

Each phase should have:
- `subject`: Phase name
- `description`: What to do in this phase
- `activeForm`: Present continuous form for spinner

## Example Workflow

```
User: "Let's start working"

Claude:
1. Reads: cat .claude/project.json
2. Checks TaskList -> empty
3. Fetches: gh project item-list {PROJECT_NUMBER} --owner @me
4. Shows available tasks to user
5. User selects task (e.g., Issue #3)
6. Claude reads: gh issue view 3
7. Creates phase todos:
   - Phase 1: Setup & Context for Issue #3
   - Phase 2: Implementation for Issue #3
   - Phase 3: Quality Check for Issue #3
   - Phase 4: Sync & Complete Issue #3
8. Marks Phase 1 as in_progress
9. Begins working
```

## Phase Transitions

| Current Phase | Action | Next Phase |
|---------------|--------|------------|
| Setup | Context gathered | Implementation |
| Implementation | Code complete | Quality Check |
| Quality Check | Tests pass | Sync & Complete |
| Sync & Complete | Issue closed | Done |

## Sync on Completion

When all phases are completed:

1. Mark final todo as `completed`
2. Close the related issue:
   ```bash
   gh issue close <number> --repo {REPOSITORY} --comment "Completed"
   ```
3. Verify project status updated

See `github-sync.md` for detailed sync commands.

## Notes

- Session todos are conversation-scoped
- GitHub Project is the source of truth
- Always sync back to GitHub when task is done
- Use phase-based tracking for visibility
