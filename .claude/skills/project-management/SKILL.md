---
name: project-management
description: GitHub Project workflow guide. Includes issue creation, PR workflow, labels usage.
---

# Project Management Guide

This project uses GitHub Projects for task tracking and workflow management.

## Quick Reference

### Creating Issues

```bash
# Feature request
gh issue create --template feature.yml

# Bug report
gh issue create --template bug.yml

# General task
gh issue create --template task.yml
```

### Labels

| Category | Labels                                                  |
| -------- | ------------------------------------------------------- |
| Type     | `type:feature`, `type:bug`, `type:task`                 |
| Priority | `priority:high`, `priority:medium`, `priority:low`      |
| Status   | `status:in-progress`, `status:blocked`, `status:review` |

### Workflow

1. Create Issue (auto-added to Project)
2. Assign milestone and labels
3. Create branch from issue
4. Submit PR (references issue)
5. Review and merge

## Milestone Workflow

When completing a milestone:
1. Verify all issues are closed
2. Close milestone with completion report
3. Include summary, completed issues list, and key deliverables

```bash
# Close milestone with report
gh api repos/{owner}/{repo}/milestones/{number} --method PATCH \
  -f state="closed" \
  -f description="## Title - Complete ✅
### Completed Issues
- #1 Issue title
..."
```

## Detailed References

- Issue workflow: `references/issue-workflow.md`
- PR workflow: `references/pr-workflow.md`
- Milestone workflow: `references/milestone-workflow.md`
