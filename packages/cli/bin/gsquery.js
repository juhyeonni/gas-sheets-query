#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Command } from 'commander'
import {
  generateCommand,
  initCommand,
  migrationCreateCommand,
  migrateCommand,
  rollbackCommand,
} from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))

const program = new Command()

program
  .name('gsquery')
  .description('CLI for gas-sheets-query schema generation and migrations')
  .version(pkg.version)

// Add all commands
program.addCommand(generateCommand)
program.addCommand(initCommand)
program.addCommand(migrationCreateCommand)
program.addCommand(migrateCommand)
program.addCommand(rollbackCommand)

program.parseAsync().catch((err) => {
  console.error(`Error: ${err.message || err}`)
  process.exit(1)
})
