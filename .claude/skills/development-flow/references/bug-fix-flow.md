# Bug Fix Flow

## Basic Process

```
1. Analysis   → Identify bug cause
2. Planning   → Propose fix approach
3. Test       → Write test that reproduces bug (RED)
4. Fix        → Fix the bug (GREEN)
5. Verify     → {test_command} && {lint_command}
```

## Detailed Steps

### 1. Analysis

```
[Read] File where error occurs
[Grep] Search related code
[Analyze] Identify cause
```

- Check error message
- Analyze stack trace
- Identify reproduction conditions

### 2. Planning

- Define fix scope
- List affected files
- Get user confirmation

### 3. Test (RED)

```
[Pseudocode]
test "should handle edge case":
    input = { problematic input }
    result = validate(input)
    assert result.success == false
```

Example patterns by language:
- **JS/TS**: `it('...', () => { expect(...).toBe(...) })`
- **Python**: `def test_...(): assert ...`
- **Go**: `func TestXxx(t *testing.T) { ... }`
- **Rust**: `#[test] fn test_...() { assert!(...) }`

- Write test that reproduces bug scenario
- Run `{test_command}` → Verify failure

### 4. Fix (GREEN)

- Fix bug with minimal changes
- Run `{test_command}` → Verify pass

### 5. Verify

```bash
{test_command}     # All tests pass
{lint_command}     # Lint pass
```

## Error Type Responses

| Error Type      | Check Items          |
| --------------- | -------------------- |
| TypeError       | null/undefined check |
| ValidationError | Review schema        |
| DatabaseError   | Query, connection    |
| APIError        | Request/response fmt |
