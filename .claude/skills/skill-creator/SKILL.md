---
name: skill-creator
description: Guide for creating and editing skills. Use when users want to create a new skill, update an existing skill, or learn about skill structure and best practices.
---

# Skill Creator

Guide for creating effective Claude Code skills in this project.

## Skill Anatomy

```
skill-name/
├── SKILL.md           # Required - Main instructions
└── references/        # Optional - Detailed docs
    └── *.md
```

## SKILL.md Template

```yaml
---
name: skill-name
description: One-line description. When to use this skill.
---

# Skill Title

Brief overview (2-3 lines)

## Quick Reference

Most frequently used commands or rules

## Workflow

Step-by-step process

## Critical Rules

Must-follow constraints

## Detailed References

- Details: `references/{file}.md`
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase, hyphens only (max 64 chars) |
| `description` | Yes | What it does + when to use. Third-person style. |
| `context` | No | Set to `fork` for subagent execution |
| `disable-model-invocation` | No | `true` = manual `/skill` only |

## Creation Process

### Step 1: Define Purpose

Answer these questions:
1. What task does this skill help with?
2. When should Claude use this skill?
3. What makes this non-obvious to Claude?

### Step 2: Structure Content

**Progressive disclosure:**
1. **SKILL.md** - Core workflow (<5k words)
2. **references/** - Detailed docs (loaded as needed)

**Content principles:**
- Write in imperative form ("Do X" not "You should X")
- Include only non-obvious information
- Avoid duplicating content between SKILL.md and references

### Step 3: Create Files

```bash
# Create skill folder
mkdir -p .claude/skills/{skill-name}/references

# Create main file
touch .claude/skills/{skill-name}/SKILL.md
```

### Step 4: Validate

**Checklist:**
- [ ] YAML frontmatter has `name` and `description`
- [ ] Description explains when to use the skill
- [ ] No hardcoded absolute paths
- [ ] No version numbers in SKILL.md
- [ ] All referenced files exist

## Best Practices

### Description Quality

```yaml
# Good - specific trigger conditions
description: This skill should be used when creating PR reviews, providing code feedback, or analyzing pull request changes.

# Bad - too vague
description: Helps with code review.
```

### Reference File Naming

**Pattern:** `<content-type>_<specificity>.md`

```
# Good
api-endpoints.md
database-schema.md
deployment-steps.md

# Bad
commands.md
reference.md
notes.md
```

### Writing Style

- **Imperative form**: "Run the command" not "You should run"
- **Concise**: Skip obvious information
- **Structured**: Use tables, lists, code blocks

## Reference Files

- Best practices: `references/best-practices.md`
- Template examples: `references/template-examples.md`
