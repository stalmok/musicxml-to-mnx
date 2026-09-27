import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { describe, expect, onTestFinished, test } from 'vitest'
import { pruneDeclarations } from '../scripts/prune-declarations.js'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-declarations-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function left(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort()
}

describe('pruneDeclarations', () => {
  test('keeps what index.d.ts reaches by every form tsc writes, and removes the rest', () => {
    const root = tree({
      'index.d.ts': [
        "export { a } from './a.js';",
        'export type {\n    B,\n} from "./b.js";',
        "export * from './c.js';",
        'export declare const d: import("./sub/d.js").D;',
      ].join('\n'),
      'a.d.ts': 'export declare const a: 1;',
      'b.d.ts': 'export type B = 1;',
      'c.d.ts': 'export {};',
      'sub/d.d.ts': "import type { E } from '../types/e.js';\nexport interface D { e: E }",
      'types/e.d.ts': 'export type E = 1;',
      'internal.d.ts': 'export {};',
      'model/score.d.ts': 'export {};',
    })

    pruneDeclarations(root)

    expect(left(root)).toEqual([
      'a.d.ts',
      'b.d.ts',
      'c.d.ts',
      'index.d.ts',
      'sub',
      join('sub', 'd.d.ts'),
      'types',
      join('types', 'e.d.ts'),
    ])
  })

  test('refuses an import that has no declaration', () => {
    const root = tree({ 'index.d.ts': 'export declare const x: import("./gone.js").X;' })

    expect(() => pruneDeclarations(root)).toThrow(
      'index.d.ts imports ./gone.js, which has no declaration',
    )
  })
})
