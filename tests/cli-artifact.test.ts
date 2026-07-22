// The built command, run as a real subprocess. The in-process tests in
// cli/run.test.ts cover the logic; this proves the shipped artifact itself —
// its shebang, its entry wiring, its exit code — actually runs, which nothing
// importing run() can show. It is skipped until the package is built.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const song = fileURLToPath(new URL('./corpus/abbott-think-of-today.mxl', import.meta.url))

// Nothing here runs unless `pnpm build` has produced the command.
const built = existsSync(cli)
const suite = built ? describe : describe.skip

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ossia-artifact-'))
})
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Runs the built command, returning its exit code and combined output. */
function runBuilt(args: readonly string[]): { code: number; output: string } {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8' })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

suite('the built command', () => {
  test('converts an .mxl to a .mnx and exits zero', () => {
    const { code } = runBuilt(['to-mnx', song, '-o', dir])

    expect(code).toBe(0)
    const mnx = JSON.parse(readFileSync(join(dir, 'abbott-think-of-today.mnx'), 'utf8')) as {
      mnx: { version: number }
    }
    expect(mnx.mnx.version).toBe(1)
  })

  test('validates its own output', () => {
    const { code, output } = runBuilt(['to-mnx', song, '-o', dir, '--validate'])

    expect(code).toBe(0)
    expect(output).not.toContain('not valid MNX')
  })

  test('exits non-zero on a file it cannot convert', () => {
    expect(runBuilt(['to-mnx', join(dir, 'nope.xml')]).code).toBe(1)
  })

  test('prints its version', () => {
    const { code, output } = runBuilt(['--version'])

    expect(code).toBe(0)
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
