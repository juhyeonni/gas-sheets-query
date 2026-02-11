/**
 * Sanitization utilities for code generation
 *
 * Provides validation and escaping to prevent code injection
 * when schema values are interpolated into generated TypeScript.
 *
 * Issue #41
 */

// =============================================================================
// Reserved Words
// =============================================================================

/**
 * JavaScript/TypeScript reserved words that cannot be used as identifiers
 */
const RESERVED_WORDS = new Set([
  // JS reserved words
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof',
  'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
  'void', 'while', 'with',
  // JS strict mode reserved
  'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
  'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield',
  // TS additional reserved
  'any', 'boolean', 'number', 'string', 'symbol', 'type', 'from', 'of',
  'namespace', 'module', 'declare', 'abstract', 'as', 'async', 'await',
])

// =============================================================================
// Identifier Validation
// =============================================================================

/**
 * Check if a value is a valid JS/TS identifier
 *
 * Rules:
 * - Must match [a-zA-Z_$][a-zA-Z0-9_$]*
 * - Must not be a JS/TS reserved word
 */
export function isValidIdentifier(value: string): boolean {
  if (!value || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value)) {
    return false
  }
  return !RESERVED_WORDS.has(value)
}

// =============================================================================
// String Escaping
// =============================================================================

/**
 * Escape a string for safe embedding in a single-quoted TypeScript string literal.
 *
 * Handles: backslash, single quote, newline, carriage return, tab, null byte
 */
export function escapeStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '\\0')
}

// =============================================================================
// String Value Validation
// =============================================================================

/**
 * Check if a string value is safe for use in generated code.
 *
 * Rejects strings containing control characters (U+0000–U+001F, U+007F–U+009F).
 */
export function isValidStringValue(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f-\x9f]/.test(value)
}
