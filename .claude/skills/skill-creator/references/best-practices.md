# Skill Best Practices

## Content Organization

### SKILL.md vs References

| Content Type | Location |
|--------------|----------|
| Core workflow | SKILL.md |
| Quick commands | SKILL.md |
| Critical rules | SKILL.md |
| Detailed procedures | references/ |
| Examples and templates | references/ |
| Schema/API docs | references/ |

### Progressive Disclosure

1. **Always loaded** (~100 tokens): name + description
2. **On trigger** (<5k tokens): SKILL.md body
3. **As needed** (unlimited): references/

## Writing Guidelines

### Do's

- Use imperative verbs: "Create", "Run", "Check"
- Include concrete examples
- Reference other skills when appropriate
- Keep SKILL.md under 5k words
- Test the skill before finalizing

### Don'ts

- Don't use second person ("You should...")
- Don't include version history
- Don't duplicate content across files
- Don't hardcode paths
- Don't include obvious information

## Quality Checklist

Before publishing:

```
[ ] name is lowercase with hyphens only
[ ] description is specific about when to trigger
[ ] SKILL.md has clear workflow section
[ ] All referenced files exist
[ ] No hardcoded user paths
[ ] No version numbers in content
[ ] Tested with real scenarios
```

## Common Patterns

### Workflow Skills

```yaml
---
name: my-workflow
description: Guides through X process. Use when user says "do X" or "start X".
---

# Workflow Title

## Quick Start
Minimal steps to begin

## Full Workflow
1. Step one
2. Step two
3. Step three

## References
- Details: `references/detailed-steps.md`
```

### Reference Skills

```yaml
---
name: my-reference
description: API/schema reference for X. Use when working with X system.
---

# Reference Title

## Quick Lookup
Most common items

## Full Reference
- Complete docs: `references/full-api.md`
```
