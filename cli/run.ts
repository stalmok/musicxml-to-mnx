// The `musicxml-to-mnx` command: convert MusicXML files to MNX.
//
// It is outside src/ because the library core is isomorphic and must not use
// Node or DOM globals. tsconfig.json enforces that over src only.
//
// run() returns an exit code and does not call process.exit, so the tests
// run it in-process.

import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { ConversionWarning } from '../src/index.js'
import { schemaErrors } from './validate.js'

/** Where the command's output lines go. The tests inject their own. */
export interface CommandIO {
  log: (line: string) => void
}

const OPTIONS = {
  // Taken as lists, so that a second value is refused rather than silently
  // replacing the first.
  out: { type: 'string', short: 'o', multiple: true },
  validate: { type: 'boolean' },
  'fail-on-loss': { type: 'boolean' },
  report: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

const HELP = `Usage: musicxml-to-mnx <files...> [options]

Convert MusicXML (.musicxml, .xml, .mxl) to MNX. Each <basename>.mnx is
written beside its input, or into the directory given by --out.

An explicit "to-mnx" before the files does the same thing, and keeps
"to-musicxml" free for the reverse direction.

Options:
  -o, --out <dir>     write the .mnx files into <dir> instead of beside the input
      --validate      check every output against the MNX schema
      --fail-on-loss  exit with code 3 if any conversion reports warnings
      --report <file> write the warnings from every file to <file> as JSON
  -h, --help          show this help
  -v, --version       show the version`

/**
 * What a path names on disk: its real path, and its device and inode when the
 * file exists. Two paths name one file when either matches. The inode catches
 * a hard link and a case-insensitive file system.
 */
interface FileIdentity {
  path: string
  inode: string | undefined
}

function identify(path: string): FileIdentity {
  // The nearest ancestor that exists is resolved through its links. The rest
  // of the path does not exist yet, so it cannot be a link. The walk ends at
  // the root at the latest.
  let existing = resolve(path)
  const rest: string[] = []
  for (;;) {
    try {
      existing = realpathSync(existing)
      break
    } catch {
      rest.unshift(basename(existing))
      existing = dirname(existing)
    }
  }
  let inode: string | undefined
  try {
    const stats = statSync(path, { bigint: true })
    inode = `${String(stats.dev)}:${String(stats.ino)}`
  } catch {
    // The file does not exist yet.
  }
  return { path: join(existing, ...rest), inode }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.path === b.path || (a.inode !== undefined && a.inode === b.inode)
}

/**
 * Writes text to path through a new temporary file beside it, then renames it
 * into place. A write that fails part way leaves nothing behind. The
 * temporary file must not exist yet, so the write never replaces or follows
 * another file. The rename replaces a link at path and does not follow it.
 */
function writeSafely(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const partial = `${path}.${randomBytes(6).toString('hex')}.partial`
  writeFileSync(partial, text, { flag: 'wx' })
  try {
    renameSync(partial, path)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
}

type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>

/** parseArgs, but a malformed command line returns a message to show. */
function parseCommandLine(argv: readonly string[]): Parsed | { error: string } {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true })
  } catch (error) {
    /* v8 ignore next -- parseArgs throws an Error; the fallback only keeps a
       stray non-Error throw from surfacing as "undefined". */
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function run(
  argv: readonly string[],
  io: CommandIO,
  // The tests pass their own check, because a conversion never produces
  // invalid MNX.
  check: (document: unknown) => string[] = schemaErrors,
): Promise<number> {
  const parsed = parseCommandLine(argv)
  if ('error' in parsed) {
    io.log(parsed.error)
    io.log(HELP)
    return 2
  }

  const { values, positionals } = parsed
  if (values.help) {
    io.log(HELP)
    return 0
  }
  if (values.version) {
    io.log(version())
    return 0
  }

  if (positionals.length === 0) {
    io.log(HELP)
    return 2
  }
  // Conversion to MNX is the default, so the positionals are files unless the
  // first names a direction. Any other name is taken as a file.
  if (positionals[0] === 'to-musicxml') {
    io.log('The reverse direction (to-musicxml) is not available yet.')
    return 2
  }
  const files = positionals[0] === 'to-mnx' ? positionals.slice(1) : positionals
  if (files.length === 0) {
    io.log('No input files given.')
    io.log(HELP)
    return 2
  }

  for (const [name, what] of [
    ['out', 'directory'],
    ['report', 'file'],
  ] as const) {
    const given = values[name]
    if (given === undefined) continue
    if (given.length > 1) {
      io.log(`--${name} is given more than once.`)
      return 2
    }
    if (given[0] === '') {
      io.log(`--${name} needs a ${what} name.`)
      return 2
    }
  }
  const out = values.out?.[0]
  const reportPath = values.report?.[0]

  const outputOf = (file: string) =>
    join(out ?? dirname(file), `${basename(file, extname(file))}.mnx`)
  const inputs = files.map(identify)

  // The report is written last, so these are refused before any output is
  // written. An output always ends in .mnx, so the extension keeps the report
  // off every output, in any letter case. The extension also catches a score
  // taken as the report's file name.
  if (reportPath !== undefined) {
    if (/\.(mnx|musicxml|xml|mxl)$/i.test(reportPath)) {
      io.log(`--report ${reportPath} must not end in .mnx, .musicxml, .xml or .mxl.`)
      return 2
    }
    if (isDirectory(reportPath)) {
      io.log(`--report ${reportPath} is a directory.`)
      return 2
    }
    const target = identify(reportPath)
    const index = inputs.findIndex((input) => sameFile(target, input))
    if (index >= 0) {
      io.log(`--report ${reportPath} would overwrite the input ${String(files[index])}.`)
      return 2
    }
  }

  const validate = values.validate ? check : undefined
  // A Map, so that an input named like an object property is kept.
  const report = new Map<string, readonly ConversionWarning[]>()
  // Catches two inputs with the same name written into one --out directory,
  // and one input named twice.
  const written: { output: FileIdentity; file: string }[] = []
  let failed = 0
  let unwritten = 0
  let lossy = 0
  let invalid = 0

  for (const file of files) {
    const outPath = outputOf(file)
    const output = identify(outPath)
    const input = files.find((_, index) => sameFile(output, inputs[index] as FileIdentity))
    if (input !== undefined) {
      io.log(`${file}: would overwrite the input ${input}; skipped.`)
      failed += 1
      continue
    }
    const already = written.find((entry) => sameFile(output, entry.output))
    if (already !== undefined) {
      io.log(`${file}: would overwrite ${outPath}, already written from ${already.file}; skipped.`)
      failed += 1
      continue
    }

    let mnx
    let warnings
    try {
      ;({ mnx, warnings } = convertMusicXML(new Uint8Array(readFileSync(file))))
    } catch (error) {
      // A refused file is reported, and the other files go on.
      io.log(`${file}: ${error instanceof MusicXMLError ? error.message : String(error)}`)
      failed += 1
      continue
    }

    // A failed write fails this file alone, as a refused file does.
    try {
      writeSafely(outPath, `${JSON.stringify(mnx, null, 2)}\n`)
    } catch (error) {
      io.log(`${file}: could not write ${outPath}: ${String(error)}`)
      unwritten += 1
      continue
    }
    written.push({ output: identify(outPath), file })

    report.set(file, warnings)
    if (warnings.length > 0) lossy += 1

    // Invalid MNX here is a bug in the converter.
    const errors = validate?.(mnx) ?? []
    if (errors.length > 0) {
      io.log(`${file}: the output is not valid MNX:`)
      for (const error of errors) io.log(`  ${error}`)
      invalid += 1
    }

    const lost = warnings.length > 0 ? ` (${String(warnings.length)} lost)` : ''
    io.log(`${file} -> ${outPath}${lost}`)
  }

  let reportFailed = false
  if (reportPath !== undefined) {
    // Creates the report's directory, so --report into a new path does not
    // fail after the outputs are written.
    try {
      writeSafely(reportPath, `${JSON.stringify(Object.fromEntries(report), null, 2)}\n`)
    } catch (error) {
      io.log(`could not write the report ${reportPath}: ${String(error)}`)
      reportFailed = true
    }
  }

  io.log(
    `Converted ${String(files.length - failed - unwritten)} of ${String(files.length)}` +
      (failed > 0 ? `, ${String(failed)} refused` : '') +
      (unwritten > 0 ? `, ${String(unwritten)} not written` : '') +
      (lossy > 0 ? `, ${String(lossy)} with losses` : '') +
      '.',
  )

  if (failed > 0 || unwritten > 0 || reportFailed) return 1
  if (invalid > 0) return 1
  // A code of its own, so a pipeline can tell a batch that converted with
  // losses from one that failed.
  if (values['fail-on-loss'] && lossy > 0) return 3
  return 0
}

/**
 * The directory of the built command. A `new URL('…', import.meta.url)` would
 * be rewritten by the bundler into an inlined asset.
 */
function commandDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** The version, read from the package manifest beside the built command. */
function version(): string {
  const manifest = join(commandDir(), '..', 'package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  return pkg.version
}
