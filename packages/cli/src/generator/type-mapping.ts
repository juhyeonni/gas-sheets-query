/**
 * Shared type mapping for code generators
 *
 * Issue #45
 */

/**
 * Map schema types to TypeScript types
 */
export function mapType(schemaType: string): string {
  switch (schemaType) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'datetime':
      return 'Date'
    default:
      // Enum or custom type - keep as-is
      return schemaType
  }
}
