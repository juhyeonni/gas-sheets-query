/**
 * Schema Parser - YAML 스키마를 AST로 변환
 * 
 * Issue #19
 */

import yaml from 'js-yaml'
import type {
  SchemaAST,
  TableAST,
  FieldAST,
  EnumAST,
  FieldAttribute,
  BlockAttribute,
  DefaultValue,
  ParseResult,
  ParseError,
  RawSchema,
  RawTableDefinition,
} from './types.js'

// =============================================================================
// Field Type Parsing
// =============================================================================

/**
 * Parse field type string (e.g., "string?")
 */
export function parseFieldType(typeStr: string): { type: string; optional: boolean } {
  const optional = typeStr.endsWith('?')
  const type = optional ? typeStr.slice(0, -1) : typeStr
  return { type, optional }
}

// =============================================================================
// Field Attributes Parsing
// =============================================================================

/**
 * Parse attribute value to appropriate type
 */
function parseAttributeValue(value: string): DefaultValue {
  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false
  
  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10)
  }
  
  // Quoted string - remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  
  // Function or enum value (keep as string)
  return value
}

/**
 * Parse field attributes string (e.g., "@id @default(autoincrement)")
 */
export function parseFieldAttributes(attrStr: string): FieldAttribute[] {
  const attributes: FieldAttribute[] = []
  
  // Regex to match @name or @name(args)
  const attrRegex = /@(\w+)(?:\(([^)]*)\))?/g
  let match: RegExpExecArray | null
  
  while ((match = attrRegex.exec(attrStr)) !== null) {
    const name = match[1] as FieldAttribute['name']
    const argsStr = match[2]
    
    const args: DefaultValue[] = []
    if (argsStr !== undefined && argsStr.length > 0) {
      args.push(parseAttributeValue(argsStr.trim()))
    }
    
    attributes.push({ name, args })
  }
  
  return attributes
}

// =============================================================================
// Full Field Parsing
// =============================================================================

/**
 * Parse a complete field definition
 */
export function parseField(name: string, definition: string): FieldAST {
  // Split type and attributes: "string @unique" → ["string", "@unique"]
  const parts = definition.trim().split(/\s+/)
  const typeWithOptional = parts[0]
  const attrStr = parts.slice(1).join(' ')
  
  const { type, optional } = parseFieldType(typeWithOptional)
  const attributes = parseFieldAttributes(attrStr)
  
  return {
    name,
    type,
    optional,
    attributes,
  }
}

// =============================================================================
// Enum Parsing
// =============================================================================

/**
 * Parse enum definition
 */
export function parseEnum(name: string, values: string[]): EnumAST {
  return {
    name,
    values: [...values],
  }
}

// =============================================================================
// Block Attributes Parsing
// =============================================================================

/**
 * Parse indexes/unique arrays into BlockAttribute[]
 * 
 * New syntax:
 *   indexes:
 *     - [ownerId]
 *     - [email, createdAt]
 *   unique:
 *     - [email]
 */
export function parseBlockAttributeArrays(
  name: 'index' | 'unique',
  arrays: Array<string[]>
): BlockAttribute[] {
  return arrays.map(fields => ({
    name,
    fields: [...fields],
  }))
}

// =============================================================================
// Table Parsing
// =============================================================================

/**
 * Parse table definition from raw YAML object
 * 
 * New syntax:
 *   User:
 *     fields:
 *       id: string @id
 *       email: string @unique
 *     indexes:
 *       - [ownerId]
 *       - [email, createdAt]
 *     unique:
 *       - [email]
 */
export function parseTable(name: string, raw: RawTableDefinition): TableAST {
  const fields: FieldAST[] = []
  const blockAttributes: BlockAttribute[] = []
  
  // Parse fields from the 'fields' section
  if (raw.fields) {
    for (const [fieldName, definition] of Object.entries(raw.fields)) {
      fields.push(parseField(fieldName, definition ?? ''))
    }
  }
  
  // Parse indexes
  if (raw.indexes && Array.isArray(raw.indexes)) {
    blockAttributes.push(...parseBlockAttributeArrays('index', raw.indexes))
  }
  
  // Parse unique constraints
  if (raw.unique && Array.isArray(raw.unique)) {
    blockAttributes.push(...parseBlockAttributeArrays('unique', raw.unique))
  }
  
  return {
    name,
    fields,
    blockAttributes,
  }
}

// =============================================================================
// Schema Parsing (Main Entry Point)
// =============================================================================

/**
 * Parse YAML schema string to AST
 */
export function parseSchema(yamlContent: string): ParseResult {
  const errors: ParseError[] = []
  
  // Handle empty content
  if (!yamlContent.trim()) {
    return {
      success: true,
      schema: {
        enums: {},
        tables: {},
      },
      errors: [],
    }
  }
  
  let raw: RawSchema
  
  try {
    raw = yaml.load(yamlContent) as RawSchema
  } catch (e) {
    const err = e as Error
    return {
      success: false,
      errors: [{ message: `YAML parse error: ${err.message}` }],
    }
  }
  
  // Handle null/undefined from yaml.load
  if (!raw) {
    return {
      success: true,
      schema: {
        enums: {},
        tables: {},
      },
      errors: [],
    }
  }
  
  const schema: SchemaAST = {
    enums: {},
    tables: {},
  }
  
  // Parse enums
  if (raw.enums) {
    for (const [name, values] of Object.entries(raw.enums)) {
      try {
        schema.enums[name] = parseEnum(name, values)
      } catch (e) {
        const err = e as Error
        errors.push({ message: err.message })
      }
    }
  }
  
  // Parse tables
  if (raw.tables) {
    for (const [name, tableDefinition] of Object.entries(raw.tables)) {
      try {
        schema.tables[name] = parseTable(name, tableDefinition)
      } catch (e) {
        const err = e as Error
        errors.push({ message: err.message, table: name })
      }
    }
  }
  
  return {
    success: true,
    schema,
    errors,
  }
}

// =============================================================================
// File-based Parsing (Convenience)
// =============================================================================

/**
 * Parse schema from file path
 */
export async function parseSchemaFile(filePath: string): Promise<ParseResult> {
  const fs = await import('fs')
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return parseSchema(content)
  } catch (e) {
    const err = e as Error
    return {
      success: false,
      errors: [{ message: `Failed to read file: ${err.message}` }],
    }
  }
}

// Re-export types for convenience
export type { 
  ParseError,
  SchemaAST,
  TableAST,
  FieldAST,
  EnumAST,
  FieldAttribute,
  BlockAttribute,
  DefaultValue,
  ParseResult,
}
