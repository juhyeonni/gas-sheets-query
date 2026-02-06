# Pull Request Workflow

## Creating PRs

### Via GitHub CLI

```bash
# Create PR with template
gh pr create

# Create PR with title and body
gh pr create --title "Add user auth" --body "closes #123"

# Create draft PR
gh pr create --draft
```

## PR Template

PRs use `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary

Brief description of changes

## Related Issue

closes #123

## Changes

- Change 1
- Change 2

## Test Plan

- [ ] Unit tests added/modified
- [ ] Tests passed
- [ ] Lint passed

## Checklist

- [ ] Code follows project style guide
- [ ] Self-review completed
```

## PR Checklist

Before submitting:

1. **Tests pass**: Run tests
2. **Lint pass**: Run linter
3. **Issue linked**: Include `closes #N` in description
4. **Branch up-to-date**: Rebase on main if needed

## Review Process

```
Draft → Ready → Review → Approved → Merged
  ↓       ↓        ↓         ↓         ↓
(WIP)  (submit) (feedback) (LGTM)   (squash)
```

## Merging

```bash
# Squash merge (preferred)
gh pr merge --squash

# Merge commit
gh pr merge --merge

# Rebase merge
gh pr merge --rebase
```

## CI Checks

PRs trigger CI workflow:

- Type check
- Lint
- Test with coverage

All checks must pass before merge.
