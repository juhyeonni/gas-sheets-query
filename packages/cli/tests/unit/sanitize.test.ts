/**
 * Tests for sanitize utility functions
 * Issue #41
 */

import { describe, it, expect } from 'vitest'
import {
  isValidIdentifier,
  escapeStringLiteral,
  isValidStringValue,
} from '../../src/utils/sanitize'

// =============================================================================
// isValidIdentifier
// =============================================================================

describe('isValidIdentifier', () => {
  it('should accept valid identifiers', () => {
    expect(isValidIdentifier('User')).toBe(true)
    expect(isValidIdentifier('myField')).toBe(true)
    expect(isValidIdentifier('_private')).toBe(true)
    expect(isValidIdentifier('$special')).toBe(true)
    expect(isValidIdentifier('a')).toBe(true)
    expect(isValidIdentifier('CamelCase123')).toBe(true)
    expect(isValidIdentifier('UPPER_CASE')).toBe(true)
  })

  it('should reject empty string', () => {
    expect(isValidIdentifier('')).toBe(false)
  })

  it('should reject identifiers starting with a digit', () => {
    expect(isValidIdentifier('1abc')).toBe(false)
    expect(isValidIdentifier('0_test')).toBe(false)
  })

  it('should reject identifiers with special characters', () => {
    expect(isValidIdentifier('my-field')).toBe(false)
    expect(isValidIdentifier('my field')).toBe(false)
    expect(isValidIdentifier('my.field')).toBe(false)
    expect(isValidIdentifier("user'; DROP TABLE--")).toBe(false)
  })

  it('should reject JavaScript reserved words', () => {
    expect(isValidIdentifier('class')).toBe(false)
    expect(isValidIdentifier('function')).toBe(false)
    expect(isValidIdentifier('return')).toBe(false)
    expect(isValidIdentifier('const')).toBe(false)
    expect(isValidIdentifier('let')).toBe(false)
    expect(isValidIdentifier('var')).toBe(false)
    expect(isValidIdentifier('import')).toBe(false)
    expect(isValidIdentifier('export')).toBe(false)
  })

  it('should reject TypeScript reserved words', () => {
    expect(isValidIdentifier('interface')).toBe(false)
    expect(isValidIdentifier('type')).toBe(false)
    expect(isValidIdentifier('namespace')).toBe(false)
    expect(isValidIdentifier('declare')).toBe(false)
    expect(isValidIdentifier('abstract')).toBe(false)
    expect(isValidIdentifier('enum')).toBe(false)
  })

  it('should reject code injection attempts', () => {
    expect(isValidIdentifier("'; process.exit(1); '")).toBe(false)
    expect(isValidIdentifier('a\nb')).toBe(false)
  })
})

// =============================================================================
// escapeStringLiteral
// =============================================================================

describe('escapeStringLiteral', () => {
  it('should return safe strings unchanged', () => {
    expect(escapeStringLiteral('hello')).toBe('hello')
    expect(escapeStringLiteral('USER')).toBe('USER')
    expect(escapeStringLiteral('my_field_123')).toBe('my_field_123')
  })

  it('should escape backslashes', () => {
    expect(escapeStringLiteral('a\\b')).toBe('a\\\\b')
  })

  it('should escape single quotes', () => {
    expect(escapeStringLiteral("it's")).toBe("it\\'s")
  })

  it('should escape newlines', () => {
    expect(escapeStringLiteral('line1\nline2')).toBe('line1\\nline2')
  })

  it('should escape carriage returns', () => {
    expect(escapeStringLiteral('line1\rline2')).toBe('line1\\rline2')
  })

  it('should escape tabs', () => {
    expect(escapeStringLiteral('col1\tcol2')).toBe('col1\\tcol2')
  })

  it('should escape null bytes', () => {
    expect(escapeStringLiteral('ab\0cd')).toBe('ab\\0cd')
  })

  it('should handle combined special characters', () => {
    expect(escapeStringLiteral("a\\b'c\nd")).toBe("a\\\\b\\'c\\nd")
  })

  it('should neutralize code injection attempts', () => {
    const malicious = "'; process.exit(1); '"
    const escaped = escapeStringLiteral(malicious)
    expect(escaped).toBe("\\'; process.exit(1); \\'")
    // Quotes are escaped, so wrapping in '...' won't break out
    expect(escaped).not.toMatch(/(?<!\\)'/)
  })
})

// =============================================================================
// isValidStringValue
// =============================================================================

describe('isValidStringValue', () => {
  it('should accept normal strings', () => {
    expect(isValidStringValue('hello')).toBe(true)
    expect(isValidStringValue('USER')).toBe(true)
    expect(isValidStringValue('my sheet name')).toBe(true)
    expect(isValidStringValue('special chars: !@#$%^&*()')).toBe(true)
    expect(isValidStringValue('')).toBe(true)
  })

  it('should reject strings with null bytes', () => {
    expect(isValidStringValue('abc\0def')).toBe(false)
  })

  it('should reject strings with newlines', () => {
    expect(isValidStringValue('line1\nline2')).toBe(false)
  })

  it('should reject strings with carriage returns', () => {
    expect(isValidStringValue('line1\rline2')).toBe(false)
  })

  it('should reject strings with tabs', () => {
    expect(isValidStringValue('col1\tcol2')).toBe(false)
  })

  it('should reject strings with other control characters', () => {
    expect(isValidStringValue('abc\x01def')).toBe(false)
    expect(isValidStringValue('abc\x7fdef')).toBe(false)
    expect(isValidStringValue('abc\x80def')).toBe(false)
  })

  it('should accept unicode characters', () => {
    expect(isValidStringValue('日本語')).toBe(true)
    expect(isValidStringValue('émojis 🎉')).toBe(true)
  })
})
