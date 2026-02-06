#!/usr/bin/env node

import { Command } from 'commander'
import { generateCommand, VERSION } from '../dist/index.js'

const program = new Command()

program
  .name('gsq')
  .description('CLI for gas-sheets-query schema generation')
  .version(VERSION)

program.addCommand(generateCommand)

program.parse()
