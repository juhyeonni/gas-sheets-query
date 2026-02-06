# GitHub Project Sync Guide

## Overview

This guide covers how to sync session todos with GitHub Projects.

## Prerequisites

Always read project config first:

```bash
cat .claude/project.json
```

Variables used below:
- `{PROJECT_NUMBER}` - Project number from config
- `{PROJECT_ID}` - Project ID from config
- `{PROJECT_OWNER}` - Project owner from config
- `{REPOSITORY}` - Repository name from config

## Creating New Tasks

### Create Issue + Add to Project

```bash
# Create issue
gh issue create --title "Task title" --body "Description" --repo {REPOSITORY}

# Get the issue URL from output, then add to project
gh project item-add {PROJECT_NUMBER} --owner {PROJECT_OWNER} --url <issue_url>
```

### One-liner (create and add)

```bash
ISSUE_URL=$(gh issue create --title "Task title" --body "Description" --repo {REPOSITORY} | grep -o 'https://[^ ]*')
gh project item-add {PROJECT_NUMBER} --owner {PROJECT_OWNER} --url $ISSUE_URL
```

## Updating Task Status

### Get Project Field IDs

```bash
# List all fields
gh project field-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json

# Find Status field ID and option IDs
gh project field-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json | jq '.fields[] | select(.name == "Status")'
```

### Get Item ID

```bash
# Find item by title
gh project item-list {PROJECT_NUMBER} --owner {PROJECT_OWNER} --format json | jq '.items[] | select(.title | contains("keyword"))'
```

### Update Status

```bash
gh project item-edit \
  --project-id {PROJECT_ID} \
  --id <ITEM_ID> \
  --field-id <STATUS_FIELD_ID> \
  --single-select-option-id <STATUS_OPTION_ID>
```

## Completing Tasks

When a session todo is marked as `completed`:

### 1. Close the Issue

```bash
gh issue close <issue_number> --repo {REPOSITORY} --comment "Completed"
```

### 2. Update Project Item Status (Optional)

The issue closure may auto-update the project status depending on project settings.

## Status Mapping

| Session Todo | GitHub Issue | Project Status |
|--------------|--------------|----------------|
| `pending` | Open | Todo |
| `in_progress` | Open | In Progress |
| `completed` | Closed | Done |

## Workflow Example

```bash
# 1. Read config
cat .claude/project.json
# Output: PROJECT_NUMBER, REPOSITORY from config

# 2. Create task
gh issue create --title "Implement feature" --body "Description" --repo {REPOSITORY}
# Output: https://github.com/{owner}/{repo}/issues/1

# 3. Add to project
gh project item-add {PROJECT_NUMBER} --owner @me --url https://github.com/{owner}/{repo}/issues/1

# 4. When done, close issue
gh issue close 1 --repo {REPOSITORY}
```

## Notes

- GitHub Project status may auto-update when issues are closed (depends on project automation settings)
- Always verify sync by checking `gh project item-list` after updates
