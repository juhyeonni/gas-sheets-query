/**
 * @gsq/cli - CLI for gas-sheets-query schema generation
 */

export { generateCommand, runGenerate, generateIndex } from './commands/generate.js'
export type { GenerateOptions, GenerateResult } from './commands/generate.js'
export { parseSchema, parseSchemaFile } from './parser/schema-parser.js'
export { generateTypes } from './generator/types-generator.js'
export { generateClient } from './generator/client-generator.js'

export const VERSION = '0.1.0'
