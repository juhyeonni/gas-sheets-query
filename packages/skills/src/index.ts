import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Root directory of the skills package (one level up from dist/) */
const PACKAGE_ROOT = join(__dirname, '..')

/** Directory containing all skill files */
export const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

/** Claude Code / openskills skill files directory */
export const CLAUDE_SKILLS_DIR = join(SKILLS_DIR, 'gsquery')

/** Generic skill files directory */
export const GENERIC_SKILLS_DIR = join(SKILLS_DIR, 'generic')

/** Supported target tools */
export type Target = 'claude' | 'cursor' | 'generic'

/** Skill file metadata */
export interface SkillFile {
  name: string
  relativePath: string
  absolutePath: string
}

/** Get all Claude-format skill files */
export function getClaudeSkillFiles(): SkillFile[] {
  return [
    { name: 'SKILL.md', relativePath: 'SKILL.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'SKILL.md') },
    { name: 'crud-and-queries.md', relativePath: 'references/crud-and-queries.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'references', 'crud-and-queries.md') },
    { name: 'joins-and-aggregation.md', relativePath: 'references/joins-and-aggregation.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'references', 'joins-and-aggregation.md') },
    { name: 'adapters-and-config.md', relativePath: 'references/adapters-and-config.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'references', 'adapters-and-config.md') },
    { name: 'migration-and-cli.md', relativePath: 'references/migration-and-cli.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'references', 'migration-and-cli.md') },
    { name: 'errors-and-viz.md', relativePath: 'references/errors-and-viz.md', absolutePath: join(CLAUDE_SKILLS_DIR, 'references', 'errors-and-viz.md') },
  ]
}

/** Get all generic-format skill files */
export function getGenericSkillFiles(): SkillFile[] {
  return [
    { name: 'gsquery-cheatsheet.md', relativePath: 'gsquery-cheatsheet.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-cheatsheet.md') },
    { name: 'gsquery-crud.md', relativePath: 'gsquery-crud.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-crud.md') },
    { name: 'gsquery-queries.md', relativePath: 'gsquery-queries.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-queries.md') },
    { name: 'gsquery-config.md', relativePath: 'gsquery-config.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-config.md') },
    { name: 'gsquery-advanced.md', relativePath: 'gsquery-advanced.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-advanced.md') },
    { name: 'gsquery-errors.md', relativePath: 'gsquery-errors.md', absolutePath: join(GENERIC_SKILLS_DIR, 'gsquery-errors.md') },
  ]
}

/** Get skill files for a specific target */
export function getSkillFiles(target: Target): SkillFile[] {
  switch (target) {
    case 'claude':
      return getClaudeSkillFiles()
    case 'cursor':
    case 'generic':
      return getGenericSkillFiles()
  }
}

/** Detect which AI tool is being used based on project directory structure */
export function detectTarget(projectDir: string): Target {
  if (existsSync(join(projectDir, '.claude'))) return 'claude'
  if (existsSync(join(projectDir, '.cursor'))) return 'cursor'
  return 'generic'
}

/** Get default destination directory for a target */
export function getDefaultDest(projectDir: string, target: Target): string {
  switch (target) {
    case 'claude':
      return join(projectDir, '.claude', 'skills', 'gsquery')
    case 'cursor':
      return join(projectDir, '.cursor', 'rules')
    case 'generic':
      return join(projectDir, '.ai', 'gsquery')
  }
}
