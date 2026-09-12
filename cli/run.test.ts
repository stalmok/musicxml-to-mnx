// The `ossia` command, driven in-process: run() does the work and returns an
// exit code, so a test can hand it arguments, then read the files it wrote and
// the lines it logged.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildValidator, run } from './run.js'

// A one-note score that converts with nothing lost, for the lossless paths.
const LOSSLESS =
  '<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part>' +
  '</part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
  '</attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
  '<type>quarter</type></note></measure></part></score-partwise>'

// The same, plus a <harmony> the converter does not carry, for the lossy paths.
const LOSSY = LOSSLESS.replace('<note>', '<harmony/><note>')

let dir: string
const lines: string[] = []
const io = { log: (line: string) => lines.push(line) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ossia-cli-'))
  lines.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Writes an input file into the temp dir, making its parent, and returns its path. */
function input(name: string, xml: string): string {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, xml)
  return path
}

describe('converting files', () => {
  test('writes a .mnx beside each input by default', async () => {
    const file = input('song.musicxml', LOSSLESS)

    const code = await run([file], io)

    expect(code).toBe(0)
    const mnx: unknown = JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8'))
    expect((mnx as { mnx: { version: number } }).mnx.version).toBe(1)
    // Nothing was lost, so the line names no count.
    expect(lines[0]).toBe(`${file} -> ${join(dir, 'song.mnx')}`)
  })

  test('converts the same way with an explicit to-mnx', async () => {
    const file = input('song.musicxml', LOSSLESS)

    const code = await run(['to-mnx', file], io)

    expect(code).toBe(0)
    const mnx: unknown = JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8'))
    expect((mnx as { mnx: { version: number } }).mnx.version).toBe(1)
  })

  test('writes into the directory --out names, creating it', async () => {
    const file = input('song.xml', LOSSLESS)
    const out = join(dir, 'built', 'nested')

    const code = await run(['to-mnx', file, '--out', out], io)

    expect(code).toBe(0)
    expect(() => readFileSync(join(out, 'song.mnx'))).not.toThrow()
  })

  test('takes -o as the short form of --out', async () => {
    const file = input('song.xml', LOSSLESS)
    const out = join(dir, 'out')

    await run(['to-mnx', file, '-o', out], io)

    expect(() => readFileSync(join(out, 'song.mnx'))).not.toThrow()
  })

  test('converts several files, and says how many', async () => {
    const a = input('a.xml', LOSSLESS)
    const b = input('b.xml', LOSSLESS)

    const code = await run(['to-mnx', a, b], io)

    expect(code).toBe(0)
    expect(lines.at(-1)).toBe('Converted 2 of 2.')
  })

  test('reads an .mxl package', async () => {
    const url = new URL('../tests/corpus/abbott-think-of-today.mxl', import.meta.url)
    const packed = join(dir, 'packed.mxl')
    writeFileSync(packed, readFileSync(url))

    const code = await run(['to-mnx', packed, '-o', dir], io)

    expect(code).toBe(0)
    expect(() => readFileSync(join(dir, 'packed.mnx'))).not.toThrow()
  })
})

describe('a file the converter refuses', () => {
  test('is reported, the others still convert, and the run fails', async () => {
    const bad = input('bad.xml', '<not-a-score/>')
    const good = input('good.xml', LOSSLESS)

    const code = await run(['to-mnx', bad, good], io)

    expect(code).toBe(1)
    expect(lines.some((line) => line.includes('bad.xml') && line.includes('score-partwise'))).toBe(
      true,
    )
    // The good one was still written.
    expect(() => readFileSync(join(dir, 'good.mnx'))).not.toThrow()
    expect(lines.at(-1)).toBe('Converted 1 of 2, 1 refused.')
  })
})

describe('two inputs that would write to the same file', () => {
  test('are caught rather than one silently overwriting the other', async () => {
    // Same basename, different directories, into one --out.
    const a = input('one/song.xml', LOSSLESS)
    const b = input('two/song.xml', LOSSLESS.replace('<step>C</step>', '<step>D</step>'))
    const out = join(dir, 'merged')

    const code = await run(['to-mnx', a, b, '-o', out], io)

    expect(code).toBe(1)
    expect(lines.some((line) => line.includes('would overwrite'))).toBe(true)
    // The first write stands; the second is skipped, not silently applied.
    const mnx = JSON.parse(readFileSync(join(out, 'song.mnx'), 'utf8')) as {
      parts: {
        measures: { sequences: { content: { notes?: { pitch: { step: string } }[] }[] }[] }[]
      }[]
    }
    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]?.notes?.[0]?.pitch.step).toBe('C')
  })
})

describe('a report into a directory that does not exist', () => {
  test('is written rather than crashing after the outputs are', async () => {
    const file = input('song.xml', LOSSY)
    const reportPath = join(dir, 'new', 'nested', 'report.json')

    const code = await run(['to-mnx', file, '-o', dir, '--report', reportPath], io)

    expect(code).toBe(0)
    expect(() => readFileSync(reportPath)).not.toThrow()
  })
})

describe('a file that cannot be read', () => {
  test('is reported like a refused one, not thrown', async () => {
    const code = await run(['to-mnx', join(dir, 'missing.xml')], io)

    expect(code).toBe(1)
    expect(lines[0]).toContain('missing.xml')
  })
})

describe('reporting losses', () => {
  test('--report writes every file’s warnings as JSON', async () => {
    const file = input('song.xml', LOSSY)
    const reportPath = join(dir, 'report.json')

    await run(['to-mnx', file, '-o', dir, '--report', reportPath], io)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<
      string,
      { code: string }[]
    >
    expect(report[file]?.[0]?.code).toBe('unsupported:element')
  })

  test('--fail-on-loss returns non-zero when a file loses notation', async () => {
    const file = input('song.xml', LOSSY)

    const code = await run(['to-mnx', file, '-o', dir, '--fail-on-loss'], io)

    expect(code).toBe(1)
    // The count of what was lost is on the file's own line.
    expect(lines[0]).toBe(`${file} -> ${join(dir, 'song.mnx')} (1 lost)`)
    expect(lines.at(-1)).toBe('Converted 1 of 1, 1 with losses.')
  })

  test('--fail-on-loss returns zero when nothing is lost', async () => {
    const file = input('song.xml', LOSSLESS)

    expect(await run(['to-mnx', file, '-o', dir, '--fail-on-loss'], io)).toBe(0)
  })
})

describe('checking the output against the schema', () => {
  test('--validate passes on a real conversion', async () => {
    const file = input('song.xml', LOSSY)

    const code = await run(['to-mnx', file, '-o', dir, '--validate'], io)

    expect(code).toBe(0)
    expect(lines.some((line) => line.includes('not valid MNX'))).toBe(false)
  })

  // A conversion never produces invalid MNX, so the reporting and the exit code
  // that follow from one are driven with a check that rejects.
  test('--validate reports every error and fails the run', async () => {
    const file = input('song.xml', LOSSLESS)
    const reject = () => () => ['/parts: must be an array', '/global: must be an object']

    const code = await run(['to-mnx', file, '-o', dir, '--validate'], io, reject)

    expect(code).toBe(1)
    expect(lines).toEqual([
      `${file}: the output is not valid MNX:`,
      '  /parts: must be an array',
      '  /global: must be an object',
      `${file} -> ${join(dir, 'song.mnx')}`,
      'Converted 1 of 1.',
    ])
  })

  // The validator itself is tested here, because a conversion never produces
  // invalid MNX for the command to catch.
  test('the validator accepts a real document and rejects a broken one', async () => {
    const file = input('song.xml', LOSSLESS)
    await run(['to-mnx', file, '-o', dir], io)
    const mnx: unknown = JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8'))

    const validate = buildValidator()
    expect(validate(mnx)).toEqual([])

    // A document missing two required properties reports both, each with the
    // place it went wrong and the reason, not just the first.
    const errors = validate({ mnx: { version: 1 } })
    expect(errors).toEqual([
      "<root>: must have required property 'global'",
      "<root>: must have required property 'parts'",
    ])
  })
})

describe('the command line itself', () => {
  test('shows help and succeeds for --help', async () => {
    expect(await run(['--help'], io)).toBe(0)
    expect(lines[0]).toContain('Usage: ossia <files...>')
  })

  test('prints a version for --version', async () => {
    expect(await run(['--version'], io)).toBe(0)
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('reserves to-musicxml for the reverse direction', async () => {
    expect(await run(['to-musicxml', 'song.xml'], io)).toBe(2)
    expect(lines[0]).toContain('not available yet')
  })

  test('takes a name that is not a direction as a file', async () => {
    expect(await run(['sideways'], io)).toBe(1)
    expect(lines[0]).toContain('sideways')
  })

  test('shows help when nothing is given', async () => {
    expect(await run([], io)).toBe(2)
    expect(lines[0]).toContain('Usage')
  })

  test('refuses to run with to-mnx but no files', async () => {
    expect(await run(['to-mnx'], io)).toBe(2)
    expect(lines[0]).toContain('No input files')
    expect(lines[1]).toContain('Usage')
  })

  test('reports an unknown option', async () => {
    const code = await run(['to-mnx', '--wat'], io)

    expect(code).toBe(2)
    expect(String(lines[0]).toLowerCase()).toContain('unknown option')
    expect(lines[1]).toContain('Usage')
  })
})
