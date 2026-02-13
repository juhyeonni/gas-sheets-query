/**
 * Schema Parser - Convert YAML schema to AST
 * 
 * Issue #19
 */

import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import {
  isBuiltInType,
  isDefaultFunction,
} from './types.js'
import { isValidIdentifier, isValidStringValue } from '../utils/sanitize.js'
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
  
  // Parse @@map (sheet name mapping)
  const mapTo = raw.map ? raw.map : undefined
  
  return {
    name,
    mapTo,
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
  
  let raw: unknown

  try {
    raw = yaml.load(yamlContent)
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

  // Runtime validation of YAML structure
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      success: false,
      errors: [{ message: `Invalid schema: expected object, got ${Array.isArray(raw) ? 'array' : typeof raw}` }],
    }
  }

  const rawSchema = raw as Record<string, unknown>

  // Validate enums field if present
  if (rawSchema.enums !== undefined) {
    if (typeof rawSchema.enums !== 'object' || Array.isArray(rawSchema.enums)) {
      return {
        success: false,
        errors: [{ message: 'Invalid schema: enums must be an object' }],
      }
    }
  }

  // Validate tables field if present
  if (rawSchema.tables !== undefined) {
    if (typeof rawSchema.tables !== 'object' || Array.isArray(rawSchema.tables)) {
      return {
        success: false,
        errors: [{ message: 'Invalid schema: tables must be an object' }],
      }
    }
  }

  const validatedRaw = rawSchema as RawSchema

  const schema: SchemaAST = {
    enums: {},
    tables: {},
  }
  
  // Parse enums
  if (validatedRaw.enums) {
    for (const [name, values] of Object.entries(validatedRaw.enums)) {
      try {
        schema.enums[name] = parseEnum(name, values)
      } catch (e) {
        const err = e as Error
        errors.push({ message: err.message })
      }
    }
  }

  // Parse tables
  if (validatedRaw.tables) {
    for (const [name, tableDefinition] of Object.entries(validatedRaw.tables)) {
      try {
        schema.tables[name] = parseTable(name, tableDefinition)
      } catch (e) {
        const err = e as Error
        errors.push({ message: err.message, table: name })
      }
    }
  }
  
  // Run semantic validation
  const validationErrors = validateSchema(schema)
  errors.push(...validationErrors)

  return {
    success: errors.length === 0,
    schema,
    errors,
  }
}

// =============================================================================
// Semantic Validation
// =============================================================================

/**
 * Validate a parsed schema AST for semantic correctness
 *
 * Checks:
 * 1. Field types must be built-in or a defined enum
 * 2. Each table must have exactly one @id field
 * 3. @default arguments must be valid (function or literal)
 * 4. Enums must have at least one value
 * 5. Enum values must not contain duplicates
 * 6. Index/unique columns must reference existing fields
 */
export function validateSchema(schema: SchemaAST): ParseError[] {
  const errors: ParseError[] = []
  const enumNames = new Set(Object.keys(schema.enums))

  // Validate enums
  for (const [name, enumDef] of Object.entries(schema.enums)) {
    // Rule: Enum name must be a valid identifier
    if (!isValidIdentifier(name)) {
      errors.push({ message: `Invalid enum name '${name}': must be a valid identifier and not a reserved word` })
    }

    // Rule 4: Enums must have at least one value
    if (enumDef.values.length === 0) {
      errors.push({ message: `Enum '${name}' must have at least one value` })
    }

    // Rule 5: No duplicate enum values
    const seen = new Set<string>()
    for (const value of enumDef.values) {
      if (seen.has(value)) {
        errors.push({ message: `Enum '${name}' has duplicate value '${value}'` })
      }
      seen.add(value)

      // Rule: Enum values must not contain control characters
      if (!isValidStringValue(value)) {
        errors.push({ message: `Enum '${name}' has invalid value '${value}': must not contain control characters` })
      }
    }
  }

  // Validate tables
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const fieldNames = new Set(table.fields.map(f => f.name))

    // Rule: Table name must be a valid identifier
    if (!isValidIdentifier(tableName)) {
      errors.push({ message: `Invalid table name '${tableName}': must be a valid identifier and not a reserved word`, table: tableName })
    }

    // Rule: Field names must be valid identifiers
    for (const field of table.fields) {
      if (!isValidIdentifier(field.name)) {
        errors.push({
          message: `Invalid field name '${field.name}' in table '${tableName}': must be a valid identifier and not a reserved word`,
          table: tableName,
          field: field.name,
        })
      }
    }

    // Rule: mapTo value must not contain control characters
    if (table.mapTo !== undefined && !isValidStringValue(table.mapTo)) {
      errors.push({
        message: `Invalid map value for table '${tableName}': must not contain control characters`,
        table: tableName,
      })
    }

    // Rule 2: Exactly one @id field
    const idFields = table.fields.filter(f =>
      f.attributes.some(a => a.name === 'id')
    )
    if (idFields.length === 0) {
      errors.push({ message: `Table '${tableName}' must have an @id field`, table: tableName })
    } else if (idFields.length > 1) {
      errors.push({
        message: `Table '${tableName}' has ${idFields.length} @id fields, expected exactly one`,
        table: tableName,
      })
    }

    for (const field of table.fields) {
      // Rule 1: Field type must be built-in or a defined enum
      if (!isBuiltInType(field.type) && !enumNames.has(field.type)) {
        errors.push({
          message: `Unknown type '${field.type}' in field '${tableName}.${field.name}'`,
          table: tableName,
          field: field.name,
        })
      }

      // Rule 3: @default arguments must be valid
      for (const attr of field.attributes) {
        if (attr.name === 'default' && attr.args.length > 0) {
          const arg = attr.args[0]
          if (typeof arg === 'string' && isIdentifierLike(arg)) {
            // Identifier-like strings must be a known function or valid enum value
            // Non-identifier strings (e.g., '#888888') are treated as quoted literals
            const isFunction = isDefaultFunction(arg)
            const isEnumValue = isEnumDefaultValue(arg, field.type, schema)
            if (!isFunction && !isEnumValue) {
              errors.push({
                message: `Invalid @default value '${arg}' in field '${tableName}.${field.name}'`,
                table: tableName,
                field: field.name,
              })
            }
          }
        }
      }
    }

    // Rule 7: @relation target must be a defined table
    // Rule 8: @relation is only allowed on string-based fields
    for (const field of table.fields) {
      const relationAttr = field.attributes.find(a => a.name === 'relation')
      if (relationAttr) {
        const target = relationAttr.args[0]
        if (typeof target !== 'string' || !target) {
          errors.push({
            message: `@relation in field '${tableName}.${field.name}' must specify a target table`,
            table: tableName,
            field: field.name,
          })
        } else {
          if (!schema.tables[target]) {
            errors.push({
              message: `@relation target '${target}' in field '${tableName}.${field.name}' is not a defined table`,
              table: tableName,
              field: field.name,
            })
          }
        }

        const stringTypes = ['string', 'string[]']
        if (!stringTypes.includes(field.type)) {
          errors.push({
            message: `@relation in field '${tableName}.${field.name}' is only allowed on string-based fields, got '${field.type}'`,
            table: tableName,
            field: field.name,
          })
        }
      }
    }

    // Rule 6: Index/unique columns must reference existing fields
    for (const blockAttr of table.blockAttributes) {
      if (blockAttr.name === 'index' || blockAttr.name === 'unique') {
        for (const col of blockAttr.fields) {
          if (!fieldNames.has(col)) {
            errors.push({
              message: `${blockAttr.name === 'index' ? 'Index' : 'Unique constraint'} references unknown field '${col}' in table '${tableName}'`,
              table: tableName,
            })
          }
        }
      }
    }
  }

  return errors
}

/**
 * Check if a string looks like an identifier (function name or enum value)
 * vs a quoted string literal that had quotes stripped by parseAttributeValue
 */
function isIdentifierLike(value: string): boolean {
  return /^[a-zA-Z_]\w*$/.test(value)
}

/**
 * Check if a @default string value is a valid enum value for the field's type
 */
function isEnumDefaultValue(value: string, fieldType: string, schema: SchemaAST): boolean {
  const enumDef = schema.enums[fieldType]
  if (!enumDef) return false
  return enumDef.values.includes(value)
}

// =============================================================================
// File-based Parsing (Convenience)
// =============================================================================

/**
 * Parse schema from file path
 */
export function parseSchemaFile(filePath: string): ParseResult {
  try {
    const content = readFileSync(filePath, 'utf-8')
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

export { isBuiltInType, isDefaultFunction } from './types.js'
export type { FieldType, DefaultFunction } from './types.js'
