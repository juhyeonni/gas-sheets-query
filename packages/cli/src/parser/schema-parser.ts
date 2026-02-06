/**
 * Schema parser - parses YAML schema to AST
 */

// TODO: Implement in #19

export interface SchemaAST {
  enums: Record<string, string[]>
  tables: Record<string, TableAST>
}

export interface TableAST {
  name: string
  fields: FieldAST[]
  blockAttributes: BlockAttribute[]
}

export interface FieldAST {
  name: string
  type: string
  optional: boolean
  attributes: Attribute[]
}

export interface Attribute {
  name: string
  args: string[]
}

export interface BlockAttribute {
  name: string
  args: string[]
}

export function parseSchema(filePath: string): SchemaAST {
  // TODO: Implement
  throw new Error('Not yet implemented - see #19')
}
