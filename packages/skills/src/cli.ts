import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { createInterface } from 'node:readline'
import {
  detectTarget,
  getDefaultDest,
  getSkillFiles,
  SKILLS_DIR,
  type Target,
  type SkillFile,
} from './index.js'

const VERSION = '0.9.0'

interface InstallOptions {
  target?: Target
  dest?: string
}

function printUsage(): void {
  console.log(`
gsquery-skills v${VERSION}

AI coding assistant context files for gas-sheets-query.

Recommended (Claude Code via openskills):
  npx openskills install @gsquery/skills

Manual install:
  gsquery-skills install [options]
  gsquery-skills info

Install options:
  --target <tool>     Target tool: claude, cursor, generic (auto-detected)
  --dest <path>       Destination directory (default: auto)

Examples:
  gsquery-skills install
  gsquery-skills install --target cursor --dest .cursor/rules
  gsquery-skills info
`.trim())
}

function printInfo(): void {
  console.log(`
gsquery-skills v${VERSION}

Skills directory: ${SKILLS_DIR}

Install (openskills):
  npx openskills install @gsquery/skills

Claude Code / openskills skill (6 files):
  skills/gsquery/SKILL.md
  skills/gsquery/references/crud-and-queries.md
  skills/gsquery/references/joins-and-aggregation.md
  skills/gsquery/references/adapters-and-config.md
  skills/gsquery/references/migration-and-cli.md
  skills/gsquery/references/errors-and-viz.md

Generic files — Cursor, Copilot, etc. (6 files):
  skills/generic/gsquery-cheatsheet.md
  skills/generic/gsquery-crud.md
  skills/generic/gsquery-queries.md
  skills/generic/gsquery-config.md
  skills/generic/gsquery-advanced.md
  skills/generic/gsquery-errors.md
`.trim())
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

function copyFiles(files: SkillFile[], dest: string): void {
  for (const file of files) {
    const targetPath = join(dest, file.relativePath)
    const targetDir = dirname(targetPath)
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }
    copyFileSync(file.absolutePath, targetPath)
    console.log(`  ${relative(process.cwd(), targetPath)}`)
  }
}

function parseArgs(args: string[]): { command: string; options: InstallOptions } {
  const command = args[0] || 'help'
  const options: InstallOptions = {}

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      const target = args[i + 1] as Target
      if (!['claude', 'cursor', 'generic'].includes(target)) {
        console.error(`Error: Invalid target "${target}". Use: claude, cursor, generic`)
        process.exit(1)
      }
      options.target = target
      i++
    } else if (args[i] === '--dest' && args[i + 1]) {
      options.dest = args[i + 1]
      i++
    }
  }

  return { command, options }
}

async function install(options: InstallOptions): Promise<void> {
  const projectDir = process.cwd()
  const target = options.target || detectTarget(projectDir)
  const dest = options.dest || getDefaultDest(projectDir, target)
  const files = getSkillFiles(target)

  console.log(`\nTarget: ${target}`)
  console.log(`Destination: ${relative(projectDir, dest) || dest}`)
  console.log(`Files to install: ${files.length}\n`)

  for (const file of files) {
    const targetPath = join(dest, file.relativePath)
    if (existsSync(targetPath)) {
      console.log(`  [overwrite] ${file.relativePath}`)
    } else {
      console.log(`  [new] ${file.relativePath}`)
    }
  }

  console.log()
  const ok = await confirm('Proceed with installation?')
  if (!ok) {
    console.log('Cancelled.')
    return
  }

  console.log('\nCopying files:')
  copyFiles(files, dest)
  console.log(`\nDone! ${files.length} files installed to ${relative(projectDir, dest) || dest}`)

  if (target === 'claude') {
    console.log('\nTo use with Claude Code, add to your CLAUDE.md:')
    console.log('  Read `.claude/skills/gsquery/SKILL.md` when working with gsquery.')
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, options } = parseArgs(argv)

  switch (command) {
    case 'install':
      await install(options)
      break
    case 'info':
      printInfo()
      break
    case 'help':
    case '--help':
    case '-h':
      printUsage()
      break
    case '--version':
    case '-v':
      console.log(VERSION)
      break
    default:
      console.error(`Unknown command: ${command}`)
      printUsage()
      process.exit(1)
  }
}
