// The `mnxml` command: convert MusicXML files to MNX.
//
// This lives outside src/ on purpose. The library core is isomorphic and may
// touch neither Node nor DOM globals, which tsconfig.json enforces over src
// alone; the command is a Node program and reaches for the filesystem freely.
//
// The work is a plain function returning an exit code rather than calling
// process.exit, so the tests drive it in-process and read what it wrote.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { ConversionWarning } from '../src/index.js'

/** Where the command's human-facing lines go. Injected so the tests can read them. */
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

const HELP = `Usage: ossia <files...> [options]

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

/** parseArgs, but a malformed command line comes back as a message to show. */
function parseCommandLine(argv: readonly string[]): Parsed | { error: string } {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true })
  } catch (error) {
    /* v8 ignore next -- parseArgs throws an Error; the fallback only keeps a
       stray non-Error throw from surfacing as "undefined". */
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function run(argv: readonly string[], io: CommandIO): Promise<number> {
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
  // first names a direction. Anything else is taken as a file, and a name that
  // is not one is reported as the file it failed to read.
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

  // Built only when asked for, so the ordinary path never touches the schema.
  const validate = values.validate ? buildValidator() : undefined
  const report: Record<string, readonly ConversionWarning[]> = {}
  // What has been written where, so two inputs with the same name written into
  // one --out directory are caught rather than one silently overwriting the
  // other.
  const writtenBy = new Map<string, string>()
  let failed = 0
  let lossy = 0
  let invalid = 0

  for (const file of files) {
    let mnx
    let warnings
    try {
      ;({ mnx, warnings } = convertMusicXML(new Uint8Array(readFileSync(file))))
    } catch (error) {
      // A file the converter refuses is reported and the rest go on, so one
      // bad file in a batch does not stop the others.
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
    writtenBy.set(outPath, file)

    mkdirSync(outDir, { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(mnx, null, 2)}\n`)

    report[file] = warnings
    if (warnings.length > 0) lossy += 1

    const errors = validate?.(mnx) ?? []
    /* v8 ignore next 5 -- reachable only if a conversion emits invalid MNX;
       the whole suite validates every output, so this is a regression guard,
       not a path real input reaches. buildValidator's own error handling is
       tested directly. */
    if (errors.length > 0) {
      io.log(`${file}: the output is not valid MNX:`)
      for (const error of errors) io.log(`  ${error}`)
      invalid += 1
    }

    const lost = warnings.length > 0 ? ` (${String(warnings.length)} lost)` : ''
    io.log(`${file} -> ${outPath}${lost}`)
  }

  if (values.report !== undefined) {
    // Create the report's directory too, so --report into a path that does not
    // exist yet writes there rather than dying after the outputs are already
    // written.
    mkdirSync(dirname(values.report), { recursive: true })
    writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`)
  }

  io.log(
    `Converted ${String(files.length - failed)} of ${String(files.length)}` +
      (failed > 0 ? `, ${String(failed)} refused` : '') +
      (lossy > 0 ? `, ${String(lossy)} with losses` : '') +
      '.',
  )

  if (failed > 0) return 1
  /* v8 ignore next -- invalid is only ever raised in the guarded block above,
     which the converter's correctness keeps unreachable. */
  if (invalid > 0) return 1
  if (values['fail-on-loss'] && lossy > 0) return 1
  return 0
}

/**
 * The directory the built command sits in. Its own path is taken apart rather
 * than a `new URL('…', import.meta.url)`, which the bundler would rewrite into
 * an inlined asset and so read the wrong thing at run time.
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

/**
 * A schema check, built only when --validate is given so that the ordinary
 * path never reads the schema. Returns one readable line per error, and
 * nothing when the document conforms.
 */
export function buildValidator(): (document: unknown) => string[] {
  const schemaPath = join(commandDir(), '..', 'schema', 'mnx-schema.json')
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object

  // strict:false because the schema uses draft-2020 keywords Ajv's strict mode
  // flags as unknown in places; it is upstream's and is not ours to rewrite.
  const validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema)

  return (document) => {
    if (validator(document)) return []
    /* v8 ignore next 3 -- the ?? fallbacks guard Ajv edge cases (no errors
       array, an error with no message) a validation failure does not produce;
       the mapping itself is exercised by the broken-document test. */
    return (validator.errors ?? []).map(
      (error) => `${error.instancePath || '<root>'}: ${error.message ?? 'invalid'}`,
    )
  }
}
