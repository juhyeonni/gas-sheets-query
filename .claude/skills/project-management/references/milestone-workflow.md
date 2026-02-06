# Milestone Workflow

## Overview

Milestones are used to group related issues into phases or releases.

## Creating Milestones

```bash
# Create milestone via API
gh api repos/{owner}/{repo}/milestones --method POST \
  -f title="Milestone Title" \
  -f description="Description" \
  -f state="open"
```

## Assigning Issues to Milestones

```bash
# When creating issue
gh issue create --title "Title" --milestone "Milestone Title"

# Update existing issue
gh issue edit {number} --milestone "Milestone Title"
```

## Closing Milestones with Reports

**IMPORTANT:** When closing a milestone, always add a completion report to the description.

### Report Template

```markdown
## {Milestone Title} - Complete ✅

### Summary
Brief description of what was accomplished.

### Completed Issues
- #{number} {title}
- #{number} {title}
...

### Key Deliverables
- Bullet points of main outputs
- New features or components created
- Architecture changes made

### Notes (optional)
Any additional context or lessons learned.
```

### Close Command

```bash
gh api repos/{owner}/{repo}/milestones/{number} --method PATCH \
  -f state="closed" \
  -f description="$(cat <<'EOF'
## Milestone Title - Complete ✅

### Summary
...

### Completed Issues
- #1 Issue title
- #2 Issue title

### Key Deliverables
- ...
EOF
)"
```

## Viewing Milestone Status

```bash
# List all milestones
gh api repos/{owner}/{repo}/milestones

# View specific milestone
gh api repos/{owner}/{repo}/milestones/{number}

# List issues in milestone
gh issue list --milestone "Milestone Title"
```

## Best Practices

1. **Create milestone before starting work** - Plan issues upfront
2. **Use descriptive titles** - Include phase number or version
3. **Set due dates** - Help track timeline
4. **Close with reports** - Document what was accomplished
5. **Link related milestones** - Reference dependencies in description
