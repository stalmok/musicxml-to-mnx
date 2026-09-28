// Adds the clone's local excludes as a third ignore file. In a worktree .git
// is a file, so git names the path.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function localExcludes(): string[] {
  try {
    const path = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return existsSync(path) ? ['--ignore-path', path] : []
  } catch {
    return []
  }
}

const prettier = fileURLToPath(import.meta.resolve('prettier/bin/prettier.cjs'))
const { status } = spawnSync(
  process.execPath,
  [
    prettier,
    ...process.argv.slice(2),
    '--ignore-path',
    '.gitignore',
    '--ignore-path',
    '.prettierignore',
    ...localExcludes(),
  ],
  { stdio: 'inherit' },
)
process.exit(status ?? 1)
