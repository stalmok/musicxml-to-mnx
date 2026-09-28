// The `musicxml-to-mnx` command: convert MusicXML files to MNX.
//
// It is outside src/ because the library core is isomorphic and must not use
// Node or DOM globals. tsconfig.json enforces that over src only.
//
// run() returns an exit code and does not call process.exit, so the tests
// run it in-process.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { ConversionWarning } from '../src/index.js'
import { compileValidator } from './validate.js'

/** Where the command's output lines go. The tests inject their own. */
export interface CommandIO {
  log: (line: string) => void
}

const OPTIONS = {
  out: { type: 'string', short: 'o' },
  validate: { type: 'boolean' },
  'fail-on-loss': { type: 'boolean' },
  report: { type: 'string' },
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
      --fail-on-loss  exit non-zero if any conversion loses notation
      --report <file> write the warnings from every file to <file> as JSON
  -h, --help          show this help
  -v, --version       show the version`

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
  makeValidator: () => (document: unknown) => string[] = buildValidator,
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

  const validate = values.validate ? makeValidator() : undefined
  const report: Record<string, readonly ConversionWarning[]> = {}
  // Catches two inputs with the same name written into one --out directory.
  const writtenBy = new Map<string, string>()
  let failed = 0
  let unwritten = 0
  let lossy = 0
  let invalid = 0

  for (const file of files) {
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

    const outDir = values.out ?? dirname(file)
    const outPath = join(outDir, `${basename(file, extname(file))}.mnx`)

    const already = writtenBy.get(outPath)
    if (already !== undefined) {
      io.log(`${file}: would overwrite ${outPath}, already written from ${already}; skipped.`)
      failed += 1
      continue
    }
    // A failed write fails this file alone, as a refused file does. The file
    // is written beside the output and moved into place, so a write that fails
    // part way leaves no .mnx behind.
    const partial = `${outPath}.partial`
    try {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(partial, `${JSON.stringify(mnx, null, 2)}\n`)
      renameSync(partial, outPath)
    } catch (error) {
      try {
        rmSync(partial)
      } catch {
        // Nothing was written there, or it cannot be removed. The write's own
        // failure is the one reported.
      }
      io.log(`${file}: could not write ${outPath}: ${String(error)}`)
      unwritten += 1
      continue
    }
    writtenBy.set(outPath, file)

    report[file] = warnings
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
  if (values.report !== undefined) {
    // Creates the report's directory, so --report into a new path does not
    // fail after the outputs are written.
    try {
      mkdirSync(dirname(values.report), { recursive: true })
      writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`)
    } catch (error) {
      io.log(`could not write the report ${values.report}: ${String(error)}`)
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
  if (values['fail-on-loss'] && lossy > 0) return 1
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

/** A schema check, built only when --validate is given. */
export function buildValidator(): (document: unknown) => string[] {
  const schemaPath = join(commandDir(), '..', 'schema', 'mnx-schema.json')
  return compileValidator(JSON.parse(readFileSync(schemaPath, 'utf8')) as object)
}
