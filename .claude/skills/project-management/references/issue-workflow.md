# Issue Workflow

## Creating Issues

### Via GitHub CLI

```bash
# Interactive creation with template
gh issue create --template feature.yml
gh issue create --template bug.yml
gh issue create --template task.yml

# Quick creation
gh issue create --title "[Feature] Add user auth" --body "Description here"
```

### Issue Templates

| Template      | Use Case                        |
| ------------- | ------------------------------- |
| `feature.yml` | New feature requests            |
| `bug.yml`     | Bug reports                     |
| `task.yml`    | Refactoring, config, docs, etc. |

## Labeling

### Required Labels

Every issue should have:

- One `type:*` label (auto-applied by template)
- One `priority:*` label

### Status Labels

Apply as work progresses:

- `status:in-progress` - Work started
- `status:blocked` - Waiting on dependency
- `status:review` - Ready for review

## Branch Naming

Create branches from issues:

```bash
# Format: {type}/{issue-number}-{short-description}
git checkout -b feature/123-user-auth
git checkout -b fix/456-login-error
git checkout -b task/789-update-deps
```

## Issue Lifecycle

```
Created → Triaged → In Progress → Review → Done
   ↓         ↓          ↓           ↓        ↓
 (new)   (labeled)  (assigned)   (PR open) (closed)
```

## Closing Issues

Issues are auto-closed when PR is merged with:

- `closes #123`
- `fixes #123`
- `resolves #123`
