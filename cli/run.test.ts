// The `musicxml-to-mnx` command, run in-process. run() returns an exit code,
// so a test can read the files it wrote and the lines it logged.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { schemaErrors } from '../tests/support/schema.js'
import { run } from './run.js'

// A one-note score that converts with nothing lost.
const LOSSLESS =
  '<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part>' +
  '</part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
  '</attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
  '<type>quarter</type></note></measure></part></score-partwise>'

// The same, plus a <harmony>, which MNX cannot carry.
const LOSSY = LOSSLESS.replace('<note>', '<harmony/><note>')

let dir: string
const lines: string[] = []
const printed: string[] = []
const io = { log: (line: string) => lines.push(line), print: (line: string) => printed.push(line) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-cli-'))
  lines.length = 0
  printed.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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
    expect(schemaErrors(mnx)).toEqual([])
    expect((mnx as { mnx: { version: number } }).mnx.version).toBe(1)
    expect(lines[0]).toBe(`${file} -> ${join(dir, 'song.mnx')}`)
  })

  test('converts the same way with an explicit to-mnx', async () => {
    const file = input('song.musicxml', LOSSLESS)

    const code = await run(['to-mnx', file], io)

    expect(code).toBe(0)
    const mnx: unknown = JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8'))
    expect(schemaErrors(mnx)).toEqual([])
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
    // The first write stands, and the second is skipped.
    const mnx = JSON.parse(readFileSync(join(out, 'song.mnx'), 'utf8')) as {
      parts: {
        measures: { sequences: { content: { notes?: { pitch: { step: string } }[] }[] }[] }[]
      }[]
    }
    expect(schemaErrors(mnx)).toEqual([])
    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]?.notes?.[0]?.pitch.step).toBe('C')
  })
})

/** Every file under root, mapped to its bytes. Links are left out. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || entry.isSymbolicLink()) continue
    const path = join(entry.parentPath, entry.name)
    files.set(path, readFileSync(path, 'latin1'))
  }
  return files
}

describe('a --report that names a file the run reads or writes', () => {
  // Each case returns the command line. The run must refuse it before it
  // writes anything.
  const cases: [string, () => string[]][] = [
    [
      'the output of its only input',
      () => [input('song.musicxml', LOSSLESS), '--report', join(dir, 'song.mnx')],
    ],
    ['its input', () => [input('song.musicxml', LOSSLESS), '--report', join(dir, 'song.musicxml')]],
    [
      'the output of another input',
      () => [input('a.xml', LOSSLESS), input('b.xml', LOSSY), '--report', join(dir, 'a.mnx')],
    ],
    [
      'an output in the --out directory',
      () => [
        input('song.xml', LOSSLESS),
        '-o',
        join(dir, 'out'),
        '--report',
        join(dir, 'out', 'song.mnx'),
      ],
    ],
    [
      'an input by a relative path',
      () => {
        const file = input('song.xml', LOSSLESS)
        return [file, '--report', relative(process.cwd(), file)]
      },
    ],
    [
      'an output by a path with . and .. in it',
      () => [input('song.xml', LOSSLESS), '--report', `${dir}/./sub/../song.mnx`],
    ],
    [
      'an input through a symbolic link',
      () => {
        const file = input('song.xml', LOSSLESS)
        symlinkSync(file, join(dir, 'link.json'))
        return [file, '-o', join(dir, 'out'), '--report', join(dir, 'link.json')]
      },
    ],
    [
      'an input through a hard link',
      () => {
        const file = input('song.xml', LOSSLESS)
        linkSync(file, join(dir, 'link.json'))
        return [file, '-o', join(dir, 'out'), '--report', join(dir, 'link.json')]
      },
    ],
    [
      'an output through a linked directory',
      () => {
        const file = input('song.xml', LOSSLESS)
        symlinkSync(dir, join(dir, 'alias'))
        return [file, '--report', join(dir, 'alias', 'song.mnx')]
      },
    ],
    [
      'an input that the converter refuses',
      () => [input('bad.xml', '<not-a-score/>'), '--report', join(dir, 'bad.xml')],
    ],
    [
      'an output through a link and ..',
      () => {
        const file = input('real/song.xml', LOSSLESS)
        mkdirSync(join(dir, 'real', 'deeper'))
        mkdirSync(join(dir, 'other'))
        symlinkSync(join(dir, 'real', 'deeper'), join(dir, 'other', 'link'))
        return [file, '--report', `${dir}/other/link/../song.mnx`]
      },
    ],
    [
      'an output named in capitals',
      () => [input('song.xml', LOSSLESS), '--report', join(dir, 'SONG.MNX')],
    ],
    // parseArgs takes the word after --report as its value.
    [
      'a score that is not an input',
      () => [input('song.xml', LOSSLESS), '--report', input('other.mxl', 'a score')],
    ],
    ['empty', () => [input('song.xml', LOSSLESS), '--report=']],
    [
      'a directory',
      () => {
        mkdirSync(join(dir, 'report.json'))
        return [input('song.xml', LOSSLESS), '--report', join(dir, 'report.json')]
      },
    ],
    [
      'given twice',
      () => [
        input('song.xml', LOSSLESS),
        '--report',
        join(dir, 'one.json'),
        '--report',
        join(dir, 'two.json'),
      ],
    ],
  ]

  test.each(cases)('is refused when it is %s, and nothing is written', async (_, argv) => {
    const args = argv()
    const before = snapshot(dir)

    const code = await run(args, io)

    expect(code).toBe(2)
    expect(snapshot(dir)).toEqual(before)
    expect(lines[0]).toMatch(/^--report /)
  })

  test('is written when it names an existing file the run does not touch', async () => {
    const file = input('song.xml', LOSSLESS)
    const reportPath = input('old-report.json', 'stale')

    expect(await run([file, '--report', reportPath], io)).toBe(0)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ [file]: [] })
  })
})

describe('an output that would overwrite an input', () => {
  test('is skipped when it is the input itself', async () => {
    const file = input('song.mnx', LOSSLESS)

    const code = await run([file], io)

    expect(code).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(LOSSLESS)
    expect(lines[0]).toBe(`${file}: would overwrite the input ${file}; skipped.`)
    expect(lines.at(-1)).toBe('Converted 0 of 1, 1 skipped.')
  })

  test('is skipped when it is another input', async () => {
    const xml = input('song.xml', LOSSLESS)
    const mnx = input('song.mnx', LOSSY)

    // song.xml writes song.mnx beside it, which is the second input.
    const code = await run([xml, mnx], io)

    expect(code).toBe(1)
    expect(readFileSync(mnx, 'utf8')).toBe(LOSSY)
    expect(lines[0]).toBe(`${xml}: would overwrite the input ${mnx}; skipped.`)
  })

  test('is skipped when the input is named through a link', async () => {
    const file = input('song.xml', LOSSLESS)
    const out = join(dir, 'out')
    mkdirSync(out)
    symlinkSync(file, join(out, 'song.mnx'))

    const code = await run([file, '-o', out], io)

    expect(code).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(LOSSLESS)
  })
})

describe('the temporary file a write goes through', () => {
  test('does not overwrite an input named like it', async () => {
    const xml = input('song.xml', LOSSLESS)
    const partial = input('song.mnx.partial', LOSSY)

    const code = await run([xml, partial], io)

    expect(code).toBe(0)
    expect(readFileSync(partial, 'utf8')).toBe(LOSSY)
    expect(readFileSync(xml, 'utf8')).toBe(LOSSLESS)
  })

  test('does not write through a link named like it', async () => {
    const a = input('a.xml', LOSSLESS)
    const b = input('b.xml', LOSSY)
    symlinkSync(b, join(dir, 'a.mnx.partial'))

    const code = await run([a, b], io)

    expect(code).toBe(0)
    expect(readFileSync(b, 'utf8')).toBe(LOSSY)
  })

  test('is not left behind', async () => {
    const file = input('song.xml', LOSSLESS)

    await run([file, '--report', join(dir, 'report.json')], io)

    expect(readdirSync(dir).sort()).toEqual(['report.json', 'song.mnx', 'song.xml'])
  })
})

describe('a --report that is a link', () => {
  test('to an output not written yet is replaced, not written through', async () => {
    const file = input('song.xml', LOSSLESS)
    const out = join(dir, 'out')
    const reportPath = join(dir, 'report.json')
    symlinkSync(join(out, 'song.mnx'), reportPath)

    const code = await run([file, '-o', out, '--report', reportPath], io)

    expect(code).toBe(0)
    expect(schemaErrors(JSON.parse(readFileSync(join(out, 'song.mnx'), 'utf8')))).toEqual([])
    expect(lstatSync(reportPath).isSymbolicLink()).toBe(false)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ [file]: [] })
  })
})

describe('one input named twice', () => {
  test('in two path forms is converted once', async () => {
    const file = input('song.xml', LOSSLESS)

    const code = await run([file, relative(process.cwd(), file)], io)

    expect(code).toBe(1)
    expect(lines.filter((line) => line.includes('would overwrite'))).toHaveLength(1)
  })
})

describe('any run', () => {
  // Every input either converts or is refused, and no input changes.
  test.each([
    ['beside the inputs', [] as string[]],
    ['into --out', ['-o', 'out']],
    ['with a report', ['--report', 'report.json']],
    [
      'with every option',
      ['-o', 'out', '--report', 'out/report.json', '--validate', '--fail-on-loss'],
    ],
  ])('leaves every input as it was, %s', async (_, options) => {
    const files = [
      input('a.musicxml', LOSSLESS),
      input('a.xml', LOSSY),
      input('b.mnx', LOSSLESS),
      input('nested/c.xml', LOSSLESS),
      input('bad.xml', '<not-a-score/>'),
    ]
    const resolved = options.map((option) => (option.startsWith('-') ? option : join(dir, option)))
    const before = snapshot(dir)

    await run([...files, ...resolved], io)

    const after = snapshot(dir)
    for (const file of files) expect(after.get(file)).toBe(before.get(file))
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

describe('an output that cannot be written', () => {
  test('is reported, the others still convert, and the run fails', async () => {
    const blocked = input('blocked.xml', LOSSLESS)
    const good = input('good.xml', LOSSLESS)
    // A directory where the output file would go.
    mkdirSync(join(dir, 'blocked.mnx'))

    const code = await run(['to-mnx', blocked, good, '--report', join(dir, 'report.json')], io)

    expect(code).toBe(1)
    expect(lines[0]).toMatch(/^.*blocked\.xml: could not write .*blocked\.mnx: .*EISDIR/)
    expect(() => readFileSync(join(dir, 'good.mnx'))).not.toThrow()
    expect(lines.at(-1)).toBe('Converted 1 of 2, 1 not written.')
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as object
    expect(Object.keys(report)).toEqual([good])
  })

  test('leaves nothing behind where it was to be written', async () => {
    const blocked = input('blocked.xml', LOSSLESS)
    mkdirSync(join(dir, 'blocked.mnx'))

    await run(['to-mnx', blocked], io)

    expect(readdirSync(dir).sort()).toEqual(['blocked.mnx', 'blocked.xml'])
  })

  // Nothing was written from the first, so the second is not a collision.
  test('does not block a later input with the same output', async () => {
    const one = input('one/song.xml', LOSSLESS)
    const two = input('two/song.xml', LOSSLESS)
    const out = join(dir, 'out')
    mkdirSync(join(out, 'song.mnx'), { recursive: true })

    await run(['to-mnx', one, two, '-o', out], io)

    expect(lines.filter((line) => line.includes('could not write'))).toHaveLength(2)
    expect(lines.some((line) => line.includes('would overwrite'))).toBe(false)
  })

  test('into an --out that cannot be made is reported for every file', async () => {
    const one = input('one.xml', LOSSLESS)
    const two = input('two.xml', LOSSLESS)
    const file = input('plain-file', '')

    const code = await run(['to-mnx', one, two, '-o', join(file, 'out')], io)

    expect(code).toBe(1)
    expect(lines.filter((line) => line.includes('could not write'))).toHaveLength(2)
    expect(lines.at(-1)).toBe('Converted 0 of 2, 2 not written.')
  })
})

describe('a report that cannot be written', () => {
  test('is reported after the outputs are written, and the run fails', async () => {
    const file = input('song.xml', LOSSLESS)
    const reportPath = join(input('plain-file', ''), 'report.json')

    const code = await run(['to-mnx', file, '--report', reportPath], io)

    expect(code).toBe(1)
    expect(() => readFileSync(join(dir, 'song.mnx'))).not.toThrow()
    expect(lines).toContainEqual(expect.stringMatching(/^could not write the report .*EEXIST/))
  })
})

describe('an --out that is not one directory', () => {
  test.each([
    ['empty', ['--out=']],
    ['given twice', ['-o', 'one', '-o', 'two']],
  ])('is refused when it is %s, and nothing is written', async (_, options) => {
    const file = input('song.xml', LOSSLESS)
    const before = snapshot(dir)

    const code = await run([file, ...options], io)

    expect(code).toBe(2)
    expect(snapshot(dir)).toEqual(before)
    expect(lines[0]).toMatch(/^--out /)
  })
})

describe('file names', () => {
  test('takes a name after -- as a file, even one that starts with a dash', async () => {
    const file = input('-song.xml', LOSSLESS)

    const code = await run(['to-mnx', '-o', join(dir, 'out'), '--', file], io)

    expect(code).toBe(0)
    expect(() => readFileSync(join(dir, 'out', '-song.mnx'))).not.toThrow()
  })

  test('drops an extension in capitals', async () => {
    const url = new URL('../tests/corpus/abbott-think-of-today.mxl', import.meta.url)
    const packed = join(dir, 'SONG.MXL')
    writeFileSync(packed, readFileSync(url))

    expect(await run([packed], io)).toBe(0)
    expect(readdirSync(dir).sort()).toEqual(['SONG.MXL', 'SONG.mnx'])
  })

  test('replaces a .mnx from an earlier run', async () => {
    const file = input('song.xml', LOSSLESS)
    writeFileSync(join(dir, 'song.mnx'), 'old')

    expect(await run([file], io)).toBe(0)
    expect(schemaErrors(JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8')))).toEqual([])
  })

  test('leaves a .mnx from an earlier run when the input is now refused', async () => {
    const file = input('song.xml', '<not-a-score/>')
    writeFileSync(join(dir, 'song.mnx'), 'old')

    expect(await run([file], io)).toBe(1)
    expect(readFileSync(join(dir, 'song.mnx'), 'utf8')).toBe('old')
  })
})

describe('the report', () => {
  test('holds every written file, keyed by its path as given', async () => {
    const lossless = input('lossless.xml', LOSSLESS)
    const lossy = input('lossy.xml', LOSSY)
    const refused = input('refused.xml', '<not-a-score/>')
    const blocked = input('blocked.xml', LOSSLESS)
    const self = input('self.mnx', LOSSLESS)
    const relativeLossy = relative(process.cwd(), lossy)
    mkdirSync(join(dir, 'blocked.mnx'))
    const reportPath = join(dir, 'report.json')

    await run([lossless, relativeLossy, refused, blocked, self, '--report', reportPath], io)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<
      string,
      { code: string }[]
    >
    expect(Object.keys(report)).toEqual([lossless, relativeLossy])
    expect(report[lossless]).toEqual([])
    expect(report[relativeLossy]?.map((warning) => warning.code)).toEqual([
      'unrepresentable:element',
    ])
  })

  test('is written when no file converts', async () => {
    const reportPath = join(dir, 'report.json')

    const code = await run([input('bad.xml', '<not-a-score/>'), '--report', reportPath], io)

    expect(code).toBe(1)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({})
  })
})

describe('the summary', () => {
  test('counts each outcome on its own', async () => {
    const files = [
      input('lossless.xml', LOSSLESS),
      input('lossy.xml', LOSSY),
      input('refused.xml', '<not-a-score/>'),
      input('blocked.xml', LOSSLESS),
      input('self.mnx', LOSSLESS),
    ]
    mkdirSync(join(dir, 'blocked.mnx'))

    const code = await run(files, io)

    expect(code).toBe(1)
    expect(lines.at(-1)).toBe(
      'Converted 2 of 5, 1 refused, 1 skipped, 1 not written, 1 with losses.',
    )
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
    expect(report[file]?.[0]?.code).toBe('unrepresentable:element')
  })

  test('--fail-on-loss returns 3 when a file loses notation', async () => {
    const file = input('song.xml', LOSSY)

    const code = await run(['to-mnx', file, '-o', dir, '--fail-on-loss'], io)

    expect(code).toBe(3)
    expect(lines[0]).toBe(`${file} -> ${join(dir, 'song.mnx')} (1 lost)`)
    expect(lines.at(-1)).toBe('Converted 1 of 1, 1 with losses.')
  })

  test('--fail-on-loss returns zero when nothing is lost', async () => {
    const file = input('song.xml', LOSSLESS)

    expect(await run(['to-mnx', file, '-o', dir, '--fail-on-loss'], io)).toBe(0)
  })

  test('--fail-on-loss returns 1 when another file is refused', async () => {
    const lossy = input('lossy.xml', LOSSY)
    const refused = input('refused.xml', '<not-a-score/>')

    expect(await run(['to-mnx', lossy, refused, '-o', dir, '--fail-on-loss'], io)).toBe(1)
  })

  test('--fail-on-loss returns 1 when the lossy output is not valid MNX', async () => {
    const file = input('song.xml', LOSSY)
    const reject = () => ['/parts: must be an array']

    const code = await run(['to-mnx', file, '-o', dir, '--fail-on-loss', '--validate'], io, reject)

    expect(code).toBe(1)
  })
})

describe('checking the output against the schema', () => {
  test('--validate passes on a real conversion', async () => {
    const file = input('song.xml', LOSSY)

    const code = await run(['to-mnx', file, '-o', dir, '--validate'], io)

    expect(code).toBe(0)
    expect(lines.some((line) => line.includes('not valid MNX'))).toBe(false)
  })

  // A conversion never produces invalid MNX, so this test uses a check that
  // rejects.
  test('--validate reports every error and fails the run', async () => {
    const file = input('song.xml', LOSSLESS)
    const reject = () => ['/parts: must be an array', '/global: must be an object']

    const code = await run(['to-mnx', file, '-o', dir, '--validate'], io, reject)

    expect(code).toBe(1)
    expect(lines).toEqual([
      `${file}: the output is not valid MNX:`,
      '  /parts: must be an array',
      '  /global: must be an object',
      `${file} -> ${join(dir, 'song.mnx')}`,
      'Converted 1 of 1, 1 not valid MNX.',
    ])
  })

  test('the validator accepts a real document and rejects a broken one', async () => {
    const file = input('song.xml', LOSSLESS)
    await run(['to-mnx', file, '-o', dir], io)
    const mnx: unknown = JSON.parse(readFileSync(join(dir, 'song.mnx'), 'utf8'))

    expect(schemaErrors(mnx)).toEqual([])

    const errors = schemaErrors({ mnx: { version: 1 } })
    expect(errors).toEqual([
      "<root>: must have required property 'global'",
      "<root>: must have required property 'parts'",
    ])
  })
})

describe('the command line itself', () => {
  test('prints help as output and succeeds for --help', async () => {
    expect(await run(['--help'], io)).toBe(0)
    expect(printed[0]).toContain('Usage: musicxml-to-mnx <files...>')
    expect(lines).toEqual([])
  })

  test('prints the package version as output for --version', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }

    expect(await run(['--version'], io)).toBe(0)
    expect(printed).toEqual([pkg.version])
    expect(lines).toEqual([])
  })

  test('writes nothing as output while converting', async () => {
    await run([input('song.xml', LOSSY), '--report', join(dir, 'report.json')], io)

    expect(printed).toEqual([])
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
