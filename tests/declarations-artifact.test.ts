// The package ships only the declarations its public entry reaches. They must
// compile on their own with library checking on. It is skipped until the
// package is built.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, onTestFinished, test } from 'vitest'

const types = fileURLToPath(new URL('../dist/types', import.meta.url))

const built = existsSync(join(types, 'index.d.ts'))
const suite = built ? describe : describe.skip

function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(types, join(entry.parentPath, entry.name)))
    .sort()
}

suite('the built declarations', () => {
  test('are the public entry and what it reaches, and nothing internal', () => {
    expect(files(types)).toEqual([
      'convert.d.ts',
      'errors.d.ts',
      'index.d.ts',
      join('types', 'mnx.d.ts'),
      'warnings.d.ts',
    ])
  })

  test('compile for a consumer with library checking on', () => {
    const consumer = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-consumer-'))
    onTestFinished(() => rmSync(consumer, { recursive: true, force: true }))
    const source = join(consumer, 'consumer.ts')
    writeFileSync(
      source,
      `import { convertMusicXML, MusicXMLError } from ${JSON.stringify(join(types, 'index.js'))}
import type { ConversionOptions, ConversionWarning, MNXDocument } from ${JSON.stringify(join(types, 'index.js'))}

const options: ConversionOptions = { scoreName: 'Full score', documentName: 'song.musicxml' }
const { mnx, warnings }: { mnx: MNXDocument; warnings: readonly ConversionWarning[] } =
  convertMusicXML('', options)
export const summary = [mnx.mnx.version, warnings.length, MusicXMLError.name]
`,
    )

    const program = ts.createProgram([source], {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      skipDefaultLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'],
      types: [],
    })
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

    expect(diagnostics).toEqual([])
  })
})
