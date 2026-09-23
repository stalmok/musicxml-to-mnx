// The built library, run where there is no Node. The bundle and the two
// packages it imports are built into one script, and the script runs in a
// fresh V8 context. It holds the ECMAScript built-ins and the few V8 adds
// (console, WebAssembly, Intl), and nothing a host adds: no process, no
// Buffer, no require, no TextDecoder, no DOM. tsconfig and the import rules
// keep Node out of the source; this shows the shipped bundle needs nothing
// from its host. It is skipped until the package is built, and compares the
// bundle with itself run under Node, so a stale build still agrees.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { build } from 'vite'
import { describe, expect, test } from 'vitest'
import { schemaErrors } from './support/schema.js'

const library = fileURLToPath(new URL('../dist/ossia.js', import.meta.url))
const song = fileURLToPath(new URL('./corpus/abbott-think-of-today.mxl', import.meta.url))

const built = existsSync(library)
const suite = built ? describe : describe.skip

async function bundle(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: { entry: library, formats: ['iife'], name: 'ossia' },
    },
  })
  const [first] = Array.isArray(output) ? output : [output]
  if (!first || !('output' in first)) throw new Error('vite returned no bundle')
  return first.output[0].code
}

let script: Promise<string> | undefined
const bundled = () => (script ??= bundle())

suite('the built library in a context with no host globals', () => {
  test('has none of the globals Node or a browser adds', () => {
    const context = createContext({})

    expect(
      runInContext(
        '[typeof process, typeof Buffer, typeof require, typeof TextDecoder, typeof window]',
        context,
      ),
    ).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  })

  test('converts an .mxl package to what Node converts it to', async () => {
    const bytes = new Uint8Array(readFileSync(song))
    const context = createContext({ bytes: [...bytes] })
    runInContext(await bundled(), context)

    // The bytes are made inside the context, so the library sees its own
    // realm's Uint8Array, as it would in a browser.
    const converted = JSON.parse(
      runInContext(
        'JSON.stringify(ossia.convertMusicXML(Uint8Array.from(bytes)))',
        context,
      ) as string,
    ) as { mnx: unknown; warnings: unknown }

    const inNode = (await import(library)) as typeof import('../src/index.js')
    expect(schemaErrors(converted.mnx)).toEqual([])
    expect(converted).toEqual(JSON.parse(JSON.stringify(inNode.convertMusicXML(bytes))))
  })

  test('refuses broken input with a MusicXMLError', async () => {
    const context = createContext({})
    runInContext(await bundled(), context)

    expect(
      runInContext(
        `try { ossia.convertMusicXML('<score-partwise') } catch (error) {
          error instanceof ossia.MusicXMLError ? 'refused' : String(error)
        }`,
        context,
      ),
    ).toBe('refused')
  })
})
