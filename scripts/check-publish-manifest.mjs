#!/usr/bin/env node
/**
 * prepublishOnly guard: refuse to publish a manifest that still carries
 * pnpm-only dependency protocols unless pnpm itself is doing the packing.
 *
 * Why: `@gsquery/cli` declares `peerDependencies: { "@gsquery/core": "workspace:*" }`
 * (and `@gsquery/client` a `workspace:*` dependency). `pnpm publish` rewrites those
 * to the real version range at pack time; `npm publish` does not — it would ship a
 * manifest that no installer can resolve, and the broken version cannot be replaced.
 *
 * Run from a package directory (that is what prepublishOnly does). Fail-closed:
 * if we cannot prove pnpm is packing, we refuse.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PNPM_ONLY_PROTOCOLS = ['workspace:', 'catalog:', 'link:']
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
]

const manifestPath = resolve(process.cwd(), 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const offenders = []
for (const field of DEPENDENCY_FIELDS) {
  for (const [name, range] of Object.entries(manifest[field] ?? {})) {
    if (typeof range === 'string' && PNPM_ONLY_PROTOCOLS.some((p) => range.startsWith(p))) {
      offenders.push(`${field}.${name}: "${range}"`)
    }
  }
}

if (offenders.length === 0) {
  process.exit(0)
}

// pnpm sets npm_config_user_agent to "pnpm/<version> ..." for lifecycle scripts;
// npm sets "npm/<version> ...". npm_execpath is the cross-check.
const userAgent = process.env.npm_config_user_agent ?? ''
const execPath = process.env.npm_execpath ?? ''
const packedByPnpm = userAgent.startsWith('pnpm/') || /pnpm/.test(execPath)

if (packedByPnpm) {
  process.exit(0)
}

console.error(
  [
    '',
    `✖ ${manifest.name}: refusing to publish — pnpm-only dependency protocols in package.json:`,
    ...offenders.map((o) => `    ${o}`),
    '',
    '  These are rewritten to real version ranges only by `pnpm publish`.',
    `  Detected publisher: ${userAgent || execPath || 'unknown (not a package-manager lifecycle)'}`,
    '',
    '  Publish with pnpm instead:',
    '    pnpm -r publish --access public',
    '    pnpm --filter <package> publish --access public',
    ''
  ].join('\n')
)
process.exit(1)
