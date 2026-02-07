#!/usr/bin/env node

import { Command } from 'commander'
import {
  generateCommand,
  initCommand,
  migrationCreateCommand,
  migrateCommand,
  rollbackCommand,
  VERSION,
} from '../dist/index.js'

const program = new Command()

program
  .name('gsq')
  .description('CLI for gas-sheets-query schema generation and migrations')
  .version(VERSION)

// Add all commands
program.addCommand(generateCommand)
program.addCommand(initCommand)
program.addCommand(migrationCreateCommand)
program.addCommand(migrateCommand)
program.addCommand(rollbackCommand)

program.parse()
