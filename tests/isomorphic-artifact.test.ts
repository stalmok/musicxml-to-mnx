// Runs the built library with no Node. The bundle and the two packages it
// imports are built into one script, which runs in a fresh V8 context. The
// context has the ECMAScript built-ins and the few that V8 adds (console,
// WebAssembly, Intl), and nothing a host adds: no process, Buffer, require,
// TextDecoder or DOM. It is skipped until the package is built. It compares
// the bundle with the same bundle run under Node, so a stale build still
// agrees.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { build } from 'vite'
import { describe, expect, test } from 'vitest'
import { schemaErrors } from './support/schema.js'

const library = fileURLToPath(new URL('../dist/musicxml-to-mnx.js', import.meta.url))
const song = fileURLToPath(new URL('./corpus/abbott-think-of-today.mxl', import.meta.url))

const built = existsSync(library)
const suite = built ? describe : describe.skip

async function bundle(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: { entry: library, formats: ['iife'], name: 'musicxmlToMnx' },
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

    // Makes the bytes inside the context, so the library sees its own realm's
    // Uint8Array, as in a browser.
    const converted = JSON.parse(
      runInContext(
        'JSON.stringify(musicxmlToMnx.convertMusicXML(Uint8Array.from(bytes)))',
        context,
      ) as string,
    ) as { mnx: unknown; warnings: unknown }

    const inNode = (await import(library)) as typeof import('../src/index.js')
    expect(schemaErrors(converted.mnx)).toEqual([])
    // Equal to the output checked against the schema above.
    // eslint-disable-next-line no-restricted-syntax
    expect(converted).toEqual(JSON.parse(JSON.stringify(inNode.convertMusicXML(bytes))))
  })

  test('refuses broken input with a MusicXMLError', async () => {
    const context = createContext({})
    runInContext(await bundled(), context)

    expect(
      runInContext(
        `try { musicxmlToMnx.convertMusicXML('<score-partwise') } catch (error) {
          error instanceof musicxmlToMnx.MusicXMLError ? 'refused' : String(error)
        }`,
        context,
      ),
    ).toBe('refused')
  })
})
