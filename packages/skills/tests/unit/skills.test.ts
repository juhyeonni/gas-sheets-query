import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectTarget,
  getDefaultDest,
  getSkillFiles,
  getClaudeSkillFiles,
  getGenericSkillFiles,
  SKILLS_DIR,
  type Target,
} from '../../src/index.js'
import { copyFiles, parseArgs } from '../../src/cli.js'

const tmpDirs: string[] = []
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gsquery-skills-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('skills package', () => {
  describe('detectTarget', () => {
    it('detects claude when .claude exists', () => {
      const dir = makeTmp()
      mkdirpClaude(dir)
      expect(detectTarget(dir)).toBe('claude')
    })

    it('detects cursor when .cursor exists', () => {
      const dir = makeTmp()
      mkdirp(join(dir, '.cursor'))
      expect(detectTarget(dir)).toBe('cursor')
    })

    it('falls back to generic', () => {
      expect(detectTarget(makeTmp())).toBe('generic')
    })
  })

  describe('getDefaultDest', () => {
    it.each<[Target, string[]]>([
      ['claude', ['.claude', 'skills', 'gsquery']],
      ['cursor', ['.cursor', 'rules']],
      ['generic', ['.ai', 'gsquery']],
    ])('returns the %s destination', (target, segments) => {
      const dir = makeTmp()
      expect(getDefaultDest(dir, target)).toBe(join(dir, ...segments))
    })
  })

  describe('getSkillFiles', () => {
    it('returns claude files for claude target', () => {
      expect(getSkillFiles('claude')).toEqual(getClaudeSkillFiles())
    })

    it('returns generic files for cursor and generic targets', () => {
      expect(getSkillFiles('cursor')).toEqual(getGenericSkillFiles())
      expect(getSkillFiles('generic')).toEqual(getGenericSkillFiles())
    })

    it('every referenced skill file exists on disk (manifest is valid)', () => {
      expect(existsSync(SKILLS_DIR)).toBe(true)
      for (const target of ['claude', 'generic'] as const) {
        for (const file of getSkillFiles(target)) {
          expect(existsSync(file.absolutePath), `missing: ${file.absolutePath}`).toBe(true)
        }
      }
    })
  })

  describe('parseArgs', () => {
    it('defaults to the help command', () => {
      expect(parseArgs([])).toEqual({ command: 'help', options: {} })
    })

    it('parses install with --target and --dest', () => {
      expect(parseArgs(['install', '--target', 'cursor', '--dest', 'out/dir'])).toEqual({
        command: 'install',
        options: { target: 'cursor', dest: 'out/dir' },
      })
    })
  })

  describe('copyFiles (file-writing install path)', () => {
    it('copies every skill file into the destination preserving structure', () => {
      const dest = makeTmp()
      const files = getClaudeSkillFiles()

      copyFiles(files, dest)

      for (const file of files) {
        const written = join(dest, file.relativePath)
        expect(existsSync(written)).toBe(true)
        // Content matches the source file.
        expect(readFileSync(written, 'utf-8')).toBe(readFileSync(file.absolutePath, 'utf-8'))
      }
    })
  })
})

function mkdirp(path: string): void {
  mkdirSync(path, { recursive: true })
}

function mkdirpClaude(dir: string): void {
  mkdirp(join(dir, '.claude'))
}
