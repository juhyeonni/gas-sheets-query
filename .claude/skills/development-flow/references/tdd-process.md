# TDD Process

## Basic Flow (TDD Required)

```
User Request
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. Analysis                                                  │
│    - Explore related files (Glob, Grep, Read)               │
│    - Identify scope of impact                               │
│    - Check current test status                              │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Planning                                                  │
│    - Propose modification approach                          │
│    - Define required test list                              │
│    - Get user confirmation                                  │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Write Tests (TDD - RED)                                   │
│    - Write failing tests first                              │
│    - Run {test_command} → Verify failure                    │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Implementation (TDD - GREEN)                              │
│    - Write minimum code to pass tests                       │
│    - Run {test_command} → Verify pass                       │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Refactoring (TDD - REFACTOR)                              │
│    - Clean up code (maintain tests)                         │
│    - Run {lint_command}                                     │
│    - Run {test_command} → Verify still passing              │
└─────────────────────────────────────────────────────────────┘
    ↓
Completion Report
```

## Test Types by Code

| Code Type        | Test Approach |
| ---------------- | ------------- |
| Schema/Types     | TDD (Unit)    |
| Service Logic    | TDD (Unit)    |
| API Routes       | Integration   |
| AI/ML Code       | Evaluation    |
| Full Flow        | E2E           |

## Notes

- Deterministic code → TDD
- AI code (LLM/ML) → Evaluation based
