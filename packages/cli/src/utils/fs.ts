/**
 * Filesystem helpers shared by the commands that write generated files.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Write file with directory creation
 */
export function writeFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath))
  writeFileSync(filePath, content, 'utf-8')
}
