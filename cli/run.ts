// The `musicxml-to-mnx` command: convert MusicXML files to MNX.
//
// It is outside src/ because the library core is isomorphic and must not use
// Node or DOM globals. tsconfig.json enforces that over src only.
//
// run() returns an exit code and does not call process.exit, so the tests
// run it in-process.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { ConversionWarning } from '../src/index.js'
import { schemaErrors } from './validate.js'

/** Where the command's lines go. The tests inject their own. */
export interface CommandIO {
  /** Progress and errors, for standard error. */
  log: (line: string) => void
  /** What was asked for (help, the version), for standard output. */
  print: (line: string) => void
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
      --report <file>.json
                      write the warnings from every file to this file
  -h, --help          show this help
  -v, --version       show the version`

/**
 * The device and inode of the file at path, or undefined when nothing is
 * there. Two paths name one file when these match, through links, other
 * path forms and letter case. Each check compares with a file that exists: an
 * input, or an output written earlier in the run. A bigint keeps a 64-bit
 * Windows file id exact.
 */
function fileId(path: string): string | undefined {
  try {
    const stats = statSync(path, { bigint: true })
    return `${String(stats.dev)}:${String(stats.ino)}`
  } catch {
    return undefined
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Writes text to path through a new temporary file beside it, then renames it
 * into place. A write that fails part way leaves nothing behind. The
 * temporary file must not exist yet, so the write never replaces or follows
 * another file. The rename replaces a link at path and does not follow it.
 * The temporary name has a fixed length of 21 characters, so a long output
 * name does not make it too long for the file system.
 */
function writeSafely(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const partial = join(dirname(path), `.${randomBytes(6).toString('hex')}.partial`)
  // Throws when a file is already at the temporary name. That file is not
  // this write's to remove.
  const fd = openSync(partial, 'wx')
  try {
    try {
      writeFileSync(fd, text)
    } finally {
      closeSync(fd)
    }
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
    io.print(HELP)
    return 0
  }
  if (values.version) {
    io.print(version())
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
  // Each input's id, mapped to the first name it was given by.
  const inputs = new Map<string, string>()
  for (const file of files) {
    const id = fileId(file)
    if (id !== undefined && !inputs.has(id)) inputs.set(id, file)
  }

  // The report is written last, so these are refused before any output is
  // written. The .json name keeps the report off every output and off a
  // score taken as the report's file name.
  if (reportPath !== undefined) {
    // The report is checked and written at this path, which has no `..` left
    // in it, so the check and the write reach the same file. Outputs get the
    // same from join().
    const reportFile = resolve(reportPath)
    if (!/\.json$/i.test(reportPath)) {
      io.log(`--report ${reportPath} must end in .json.`)
      return 2
    }
    if (isDirectory(reportFile)) {
      io.log(`--report ${reportPath} is a directory.`)
      return 2
    }
    // The outputs make --out and every directory above it.
    const outDir = out === undefined ? undefined : resolve(out)
    if (
      outDir !== undefined &&
      (outDir === reportFile || outDir.startsWith(`${reportFile}${sep}`))
    ) {
      io.log(`--report ${reportPath} names the --out directory or one above it.`)
      return 2
    }
    const target = fileId(reportFile)
    const named = target === undefined ? undefined : inputs.get(target)
    if (named !== undefined) {
      io.log(`--report ${reportPath} would overwrite the input ${named}.`)
      return 2
    }
  }

  const validate = values.validate ? check : undefined
  // A Map, so that an input named like an object property is kept.
  const report = new Map<string, readonly ConversionWarning[]>()
  // Catches two inputs with the same name written into one --out directory,
  // and one input named twice.
  // Each written output's id, mapped to the input it was written from.
  const written = new Map<string, string>()
  let failed = 0
  let skipped = 0
  let unwritten = 0
  let lossy = 0
  let invalid = 0

  for (const file of files) {
    const outPath = outputOf(file)
    const output = fileId(outPath)
    const input = output === undefined ? undefined : inputs.get(output)
    if (input !== undefined) {
      io.log(`${file}: would overwrite the input ${input}; skipped.`)
      skipped += 1
      continue
    }
    const already = output === undefined ? undefined : written.get(output)
    if (already !== undefined) {
      io.log(`${file}: would overwrite ${outPath}, already written from ${already}; skipped.`)
      skipped += 1
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
    // An output whose id cannot be read is left out, or every later output
    // that does not exist yet would match it.
    const id = fileId(outPath)
    if (id !== undefined) written.set(id, file)

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
      writeSafely(resolve(reportPath), `${JSON.stringify(Object.fromEntries(report), null, 2)}\n`)
    } catch (error) {
      io.log(`could not write the report ${reportPath}: ${String(error)}`)
      reportFailed = true
    }
  }

  io.log(
    `Converted ${String(files.length - failed - skipped - unwritten)} of ${String(files.length)}` +
      (failed > 0 ? `, ${String(failed)} refused` : '') +
      (skipped > 0 ? `, ${String(skipped)} skipped` : '') +
      (unwritten > 0 ? `, ${String(unwritten)} not written` : '') +
      (invalid > 0 ? `, ${String(invalid)} not valid MNX` : '') +
      (lossy > 0 ? `, ${String(lossy)} with losses` : '') +
      '.',
  )

  if (failed > 0 || skipped > 0 || unwritten > 0 || reportFailed) return 1
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
