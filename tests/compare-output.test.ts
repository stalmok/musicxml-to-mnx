import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, onTestFinished, test } from 'vitest'
import { compareFiles, firstDifference, outcomeOf, scoreFiles } from '../scripts/compare-output.js'
import type { Library } from '../scripts/compare-output.js'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-compare-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

class RefusalForTest extends Error {
  readonly path = ['part P1', 'measure 2']
  readonly line = 7
}

function library(convert: Library['convertMusicXML']): Library {
  // eslint-disable-next-line no-restricted-syntax -- a stand-in for the library, not the converter
  return { convertMusicXML: convert, MusicXMLError: RefusalForTest }
}

const input = new TextEncoder().encode('<score-partwise/>')

describe('firstDifference', () => {
  test('finds none between values equal apart from key order', () => {
    expect(firstDifference({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(
      undefined,
    )
  })

  test('names the first differing leaf by its JSON path', () => {
    expect(firstDifference({ a: [1, { b: 'x' }], c: 1 }, { a: [1, { b: 'y' }], c: 2 })).toEqual({
      at: '$.a[1].b',
      base: 'x',
      current: 'y',
    })
  })

  test('names a key only one side has', () => {
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toEqual({
      at: '$.b',
      base: undefined,
      current: 2,
    })
    expect(firstDifference({ a: 1, b: 2 }, { a: 1 })).toEqual({
      at: '$.b',
      base: 2,
      current: undefined,
    })
  })

  test('names the first index only one array has', () => {
    expect(firstDifference([1, 2], [1, 2, 3])).toEqual({ at: '$[2]', base: undefined, current: 3 })
    expect(firstDifference([1, 2, 3], [1, 2])).toEqual({ at: '$[2]', base: 3, current: undefined })
  })

  test('tells an array from an object with the same entries', () => {
    expect(firstDifference(['a'], { 0: 'a' })).toEqual({
      at: '$',
      base: ['a'],
      current: { 0: 'a' },
    })
  })
})

describe('outcomeOf', () => {
  const converted = library(() => ({
    mnx: { mnx: { version: 1 }, dropped: undefined },
    warnings: [{ message: 'lost', code: 'unsupported:element' }],
  }))

  test('keeps the MNX and the warnings as JSON', () => {
    expect(outcomeOf(converted, input, {})).toStrictEqual({
      mnx: { mnx: { version: 1 } },
      warnings: [{ message: 'lost', code: 'unsupported:element' }],
    })
  })

  test('leaves the warnings out with mnxOnly', () => {
    expect(outcomeOf(converted, input, { mnxOnly: true })).toStrictEqual({
      mnx: { mnx: { version: 1 } },
    })
  })

  test('leaves the warning messages out with ignoreMessages', () => {
    expect(outcomeOf(converted, input, { ignoreMessages: true })).toStrictEqual({
      mnx: { mnx: { version: 1 } },
      warnings: [{ code: 'unsupported:element' }],
    })
  })

  test('records a refusal with its message and location', () => {
    const refusing = library(() => {
      throw new RefusalForTest('A <note> states none of <pitch>, <unpitched> and <rest>.')
    })

    expect(outcomeOf(refusing, input, {})).toStrictEqual({
      refused: {
        message: 'A <note> states none of <pitch>, <unpitched> and <rest>.',
        path: ['part P1', 'measure 2'],
        line: 7,
      },
    })
  })

  test('records any other error as a crash', () => {
    const crashing = library(() => {
      throw new RangeError('Invalid array length')
    })

    expect(outcomeOf(crashing, input, {})).toStrictEqual({
      crashed: 'RangeError: Invalid array length',
    })
  })

  test('records a thrown value that is not an error as it is', () => {
    const throwing = library(() => {
      throw 'out of memory'
    })

    expect(outcomeOf(throwing, input, {})).toStrictEqual({ crashed: 'out of memory' })
  })
})

describe('scoreFiles', () => {
  test('finds score files at any depth, sorted, and skips hidden directories', () => {
    const root = tree({
      'b.mxl': '',
      'a.xml': '',
      'sub/c.musicxml': '',
      'sub/notes.txt': '',
      '.git/d.xml': '',
    })

    expect(scoreFiles([root])).toEqual([
      join(root, 'a.xml'),
      join(root, 'b.mxl'),
      join(root, 'sub', 'c.musicxml'),
    ])
  })

  test('follows a linked directory once, and matches extensions in any case', () => {
    const root = tree({ 'scores/A.MXL': '', 'scores/b.XML': '' })
    symlinkSync(join(root, 'scores'), join(root, 'linked'))
    symlinkSync(root, join(root, 'scores', 'loop'))

    expect(scoreFiles([join(root, 'linked')])).toEqual([
      join(root, 'linked', 'A.MXL'),
      join(root, 'linked', 'b.XML'),
    ])
  })
})

describe('compareFiles', () => {
  test('reports each file the two modules convert or refuse differently', async () => {
    // Each module has its own error class. A refusal both state alike is the
    // same only where each is told apart by its own module's class.
    const module = (version: string) =>
      'export class MusicXMLError extends Error {\n' +
      "  path = ['part P1']\n" +
      '  line = 3\n' +
      '}\n' +
      'export function convertMusicXML(input) {\n' +
      '  const text = new TextDecoder().decode(input)\n' +
      "  if (text === 'refused') throw new MusicXMLError('refused')\n" +
      `  if (text === 'reworded') throw new MusicXMLError('refused by ${version}')\n` +
      `  return { mnx: { text, version: text === 'same' ? 1 : ${version} }, warnings: [] }\n` +
      '}\n'
    const root = tree({
      'base.mjs': module('1'),
      'current.mjs': module('2'),
      'scores/same.xml': 'same',
      'scores/changed.xml': 'changed',
      'scores/refused.xml': 'refused',
      'scores/reworded.xml': 'reworded',
    })

    const differences = await compareFiles(
      join(root, 'base.mjs'),
      join(root, 'current.mjs'),
      scoreFiles([join(root, 'scores')]),
      {},
    )

    expect(differences).toStrictEqual([
      { file: join(root, 'scores', 'changed.xml'), at: '$.mnx.version', base: 1, current: 2 },
      {
        file: join(root, 'scores', 'reworded.xml'),
        at: '$.refused.message',
        base: 'refused by 1',
        current: 'refused by 2',
      },
    ])
  })
})
