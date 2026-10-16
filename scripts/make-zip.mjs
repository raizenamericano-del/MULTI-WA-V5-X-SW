#!/usr/bin/env node
/**
 * Builds a clean, shareable ZIP of the project.
 *
 *   npm run zip                      -> wa-multi-device-controller.zip
 *   node scripts/make-zip.mjs out.zip
 *
 * Strategy: zip tracked and new non-ignored source files from git (`git ls-files --cached --others --exclude-standard`), which already
 * excludes node_modules, .next, .env, data/auth, data/media, *.db, logs, etc.
 * When git is not available it falls back to a glob + exclusion list.
 *
 * Requires the `zip` CLI (Linux/macOS). On Windows use WSL or Git Bash.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const output = path.resolve(root, process.argv[2] || 'wa-multi-device-controller.zip')
if (fs.existsSync(output)) fs.rmSync(output)

const JUNK = [
  'node_modules/*',
  '.next/*',
  '.git/*',
  '.env',
  '.env.local',
  'data/auth/*',
  'data/media/*',
  'prisma/dev.db*',
  '*.db',
  '*.db-journal',
  '*.log',
  '*.zip',
  '*.tsbuildinfo',
  '.DS_Store',
  '.vscode/*',
  '.idea/*',
  '.eslintcache',
]

function trackedFiles() {
  try {
    const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'buffer' })
    const files = [...new Set(stdout.toString('utf8').split('\0').filter(Boolean))].filter(file => {
      const parts = file.split('/')
      const name = parts.at(-1)
      if (parts.some(part => ['node_modules', '.git', '.next', 'runtime'].includes(part))) return false
      if (file.startsWith('data/') && !file.endsWith('/.gitkeep')) return false
      if (name.startsWith('.env') && name !== '.env.example') return false
      if (/\.(db|sqlite|sqlite3|log|zip|tsbuildinfo)(-|$)/.test(name)) return false
      return true
    })
    return files.length > 0 ? files : null
  } catch {
    return null
  }
}

try {
  const files = trackedFiles()

  if (files) {
    // Write the file list to a temp manifest so we never hit argv limits.
    const manifest = path.join(root, '.zip-manifest')
    fs.writeFileSync(manifest, files.join('\n'))
    try {
      execFileSync('zip', ['-q', '-X', output, '-@'], {
        cwd: root,
        input: files.join('\n'),
        stdio: ['pipe', 'inherit', 'inherit'],
      })
    } finally {
      fs.rmSync(manifest, { force: true })
    }
  } else {
    execFileSync('zip', ['-r', '-q', output, '.', '-x', ...JUNK], { cwd: root, stdio: 'inherit' })
  }

  const size = (fs.statSync(output).size / 1024 / 1024).toFixed(2)
  console.log(`\n✅ Created ${path.relative(root, output) || output} (${size} MB)`)
  console.log(`   ${files ? files.length : '?'} files · no node_modules / .next / .env / data / databases`)
} catch (error) {
  console.error('❌ Failed to create the zip. Is the `zip` CLI installed?')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
