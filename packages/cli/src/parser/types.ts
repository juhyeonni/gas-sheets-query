/**
 * Schema AST Types
 * 
 * These types represent the parsed schema structure.
 */

// ============================================================================
// Primitive Types
// ============================================================================

/**
 * Supported field types
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'datetime'

/**
 * Built-in default value functions
 */
export type DefaultFunction = 'autoincrement' | 'now'

/**
 * Default value - can be a literal or a function
 */
export type DefaultValue = 
  | string 
  | number 
  | boolean 
  | DefaultFunction

// ============================================================================
// Attributes
// ============================================================================

/**
 * Field attribute (e.g., @id, @unique, @default(value))
 */
export interface FieldAttribute {
  /** Attribute name without @ */
  name: 'id' | 'unique' | 'default' | 'updatedAt'
  /** Arguments (e.g., for @default) */
  args: DefaultValue[]
}

/**
 * Block attribute (e.g., @@index, @@unique, @@map)
 */
export interface BlockAttribute {
  /** Attribute name without @@ */
  name: 'index' | 'unique' | 'map'
  /** Field names (for index/unique) */
  fields: string[]
  /** Map target name (for @@map) */
  mapTo?: string
}

// ============================================================================
// Field & Table
// ============================================================================

/**
 * Parsed field definition
 */
export interface FieldAST {
  /** Field name */
  name: string
  /** Field type (string, number, boolean, datetime, or enum name) */
  type: string
  /** Whether the field is optional (has ?) */
  optional: boolean
  /** Field attributes */
  attributes: FieldAttribute[]
}

/**
 * Parsed table definition
 */
export interface TableAST {
  /** Table name */
  name: string
  /** Mapped sheet name (from @@map) */
  mapTo?: string
  /** Fields in order */
  fields: FieldAST[]
  /** Block attributes (@@index, @@unique) */
  blockAttributes: BlockAttribute[]
}

// ============================================================================
// Enum
// ============================================================================

/**
 * Parsed enum definition
 */
export interface EnumAST {
  /** Enum name */
  name: string
  /** Enum values */
  values: string[]
}

// ============================================================================
// Schema (Root)
// ============================================================================

/**
 * Complete parsed schema
 */
export interface SchemaAST {
  /** Enum definitions */
  enums: Record<string, EnumAST>
  /** Table definitions */
  tables: Record<string, TableAST>
}

// ============================================================================
// Parser Helpers
// ============================================================================

/**
 * Raw table structure with fields, indexes, unique sections
 */
export interface RawTableDefinition {
  fields: Record<string, string>
  indexes?: Array<string[]>
  unique?: Array<string[]>
  /** Sheet name mapping (@@map equivalent) */
  map?: string
}

/**
 * Raw YAML schema structure (before parsing)
 */
export interface RawSchema {
  enums?: Record<string, string[]>
  tables?: Record<string, RawTableDefinition>
}

/**
 * Parse result with potential errors
 */
export interface ParseResult {
  success: boolean
  schema?: SchemaAST
  errors: ParseError[]
}

/**
 * Parse error with location
 */
export interface ParseError {
  message: string
  table?: string
  field?: string
  line?: number
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a type is a built-in type
 */
export function isBuiltInType(type: string): type is FieldType {
  return ['string', 'number', 'boolean', 'datetime'].includes(type)
}

/**
 * Check if a default value is a function
 */
export function isDefaultFunction(value: DefaultValue): value is DefaultFunction {
  return value === 'autoincrement' || value === 'now'
}
