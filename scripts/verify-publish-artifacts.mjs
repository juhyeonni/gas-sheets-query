#!/usr/bin/env node
/**
 * Pack every publishable workspace package and assert the tarball is fit to publish:
 *
 *   - README.md and LICENSE at the package root (npm renders the first, npm/legal
 *     tooling reads the second — a `files: ["dist"]` list silently omits both unless
 *     npm's implicit inclusion kicks in, so we verify the real artifact)
 *   - dist/ present (the package actually ships code)
 *   - no src/ or tests/ leakage
 *   - no pnpm-only dependency protocols (workspace:/catalog:/link:) left in the
 *     packed manifest — see scripts/check-publish-manifest.mjs
 *
 * Requires a prior `pnpm build`: pack does not run prepublishOnly.
 *
 * Usage: node scripts/verify-publish-artifacts.mjs [--list]
 */
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const showList = process.argv.includes('--list')

const PNPM_ONLY_PROTOCOLS = ['workspace:', 'catalog:', 'link:']
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
]

/** Minimal tar reader: returns [{ name, content }] for regular files. */
function readTar(buffer) {
  const entries = []
  let offset = 0
  let longName = null

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break

    const readString = (start, length) => {
      const raw = header.subarray(start, start + length)
      const end = raw.indexOf(0)
      return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8')
    }

    const size = parseInt(readString(124, 12).trim() || '0', 8)
    const typeFlag = String.fromCharCode(header[156])
    const prefix = readString(345, 155)
    const rawName = readString(0, 100)
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName)
    longName = null

    const dataStart = offset + 512
    const data = buffer.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512

    if (typeFlag === 'L') {
      // GNU long name: the payload is the next entry's path.
      longName = data.toString('utf8').replace(/\0+$/, '')
    } else if (typeFlag === 'x' || typeFlag === 'X') {
      // pax extended header: "<len> path=<value>\n"
      const match = data.toString('utf8').match(/\d+ path=(.*)\n/)
      if (match) longName = match[1]
    } else if (typeFlag === '0' || typeFlag === '\0') {
      entries.push({ name, content: data })
    }
  }

  return entries
}

const packagesDir = join(repoRoot, 'packages')
const publishable = readdirSync(packagesDir)
  .map((name) => join(packagesDir, name))
  .filter((dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true
    } catch {
      return false
    }
  })
  .sort()

let failed = false
const outDir = mkdtempSync(join(tmpdir(), 'gsquery-pack-'))

try {
  for (const packageDir of publishable) {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    console.log(`\n=== ${manifest.name}@${manifest.version} ===`)

    execFileSync('pnpm', ['pack', '--pack-destination', outDir], {
      cwd: packageDir,
      stdio: ['ignore', 'ignore', 'inherit']
    })

    const tarballs = readdirSync(outDir).filter((f) => f.endsWith('.tgz'))
    const tarball = join(outDir, tarballs[tarballs.length - 1])
    const entries = readTar(gunzipSync(readFileSync(tarball)))
    const files = entries.map((e) => e.name.replace(/^package\//, '')).sort()

    const problems = []
    const require = (predicate, message) => {
      if (!predicate) problems.push(message)
    }

    require(files.includes('README.md'), 'missing README.md at package root')
    require(files.includes('LICENSE'), 'missing LICENSE at package root')
    require(files.includes('package.json'), 'missing package.json')
    require(
      files.some((f) => f.startsWith('dist/')),
      'no dist/ output — run `pnpm build` first'
    )

    const leaked = files.filter((f) => f.startsWith('src/') || f.startsWith('tests/'))
    require(leaked.length === 0, `source/test leakage: ${leaked.slice(0, 5).join(', ')}`)

    const packedManifest = JSON.parse(
      entries.find((e) => e.name === 'package/package.json').content.toString('utf8')
    )
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dep, range] of Object.entries(packedManifest[field] ?? {})) {
        require(
          !(typeof range === 'string' && PNPM_ONLY_PROTOCOLS.some((p) => range.startsWith(p))),
          `unresolved pnpm protocol in packed manifest: ${field}.${dep} = "${range}"`
        )
      }
    }

    const summary = new Map()
    for (const file of files) {
      const top = file.includes('/') ? `${file.split('/')[0]}/` : file
      summary.set(top, (summary.get(top) ?? 0) + 1)
    }
    for (const [top, count] of [...summary].sort()) {
      console.log(count === 1 && !top.endsWith('/') ? `  ${top}` : `  ${top} (${count} files)`)
    }
    if (showList) for (const file of files) console.log(`    ${file}`)

    if (problems.length > 0) {
      failed = true
      for (const problem of problems) console.error(`  ✖ ${problem}`)
    } else {
      console.log(`  ✔ ${files.length} files, publish-ready`)
    }

    rmSync(tarball)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\n✖ publish artifact verification failed')
  process.exit(1)
}
console.log('\n✔ all packages publish-ready')
