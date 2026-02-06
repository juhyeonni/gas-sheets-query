/**
 * Generate command - generates types and client from schema
 */

import { Command } from 'commander'

export const generateCommand = new Command('generate')
  .description('Generate types and client from schema')
  .option('-s, --schema <path>', 'Schema file path', 'schema.gsq.yaml')
  .option('-o, --output <path>', 'Output directory', 'generated')
  .option('-w, --watch', 'Watch for changes')
  .action(async (options) => {
    console.log('🚧 Generate command not yet implemented')
    console.log('Options:', options)
    // TODO: Implement in #22
  })
