// Converts every score with two builds of the library, one of a base commit
// and one of the working tree, and reports each file whose output differs.
// A change that must not alter output passes when no file differs.
//
//   node scripts/compare-output.ts <base-ref> [--mnx-only] [--ignore-messages] [directory...]
//
// The directories default to tests/corpus. Output is compared as JSON: the
// MNX, every warning with its context, and the message and location of a
// refusal. Key order inside an object is not compared.
//
// Both builds run against this checkout's node_modules, so a change in a
// dependency's version is not compared. The script says so where the
// lockfile differs from the base.
//
// Exits 0 where every file converts the same, 1 where any differs, and 2
// where the comparison could not run.

import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

const SCORE_EXTENSIONS = ['.mxl', '.musicxml', '.xml']

// With no limit each worker's heap grows until the collector runs, and eight
// workers took 7 GB over 20,000 files. The largest score tried, 27 MB of
// MusicXML, needs between 512 and 768 MB. A worker at this limit takes about
// 1.1 GB in all, so each one started needs 1.5 GB free.
const WORKER_HEAP_MB = 1024
const WORKER_MEMORY_BYTES = 1.5 * 1024 ** 3

export interface CompareOptions {
  /** Compare the MNX alone, and not the warnings. */
  mnxOnly?: boolean
  /** Compare the warnings without their message text. */
  ignoreMessages?: boolean
}

/** The part of the library's public API this script calls. */
export interface Library {
  convertMusicXML(input: Uint8Array): { mnx: unknown; warnings: readonly { message: string }[] }
  MusicXMLError: abstract new (...args: never[]) => Error & {
    path: readonly string[]
    line: number | undefined
  }
}

export interface Difference {
  /** Where the two outputs first differ, as a JSON path. */
  at: string
  base: unknown
  current: unknown
}

export interface FileDifference extends Difference {
  file: string
}

/**
 * Every score file under the directories, sorted. Symbolic links are
 * followed, each directory is walked once, and hidden entries are skipped.
 */
export function scoreFiles(directories: readonly string[]): string[] {
  const found: string[] = []
  const walked = new Set<string>()
  const walk = (directory: string): void => {
    const real = realpathSync(directory)
    if (walked.has(real)) return
    walked.add(real)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      const stats = entry.isSymbolicLink() ? statSync(path) : entry
      const name = entry.name.toLowerCase()
      if (stats.isDirectory()) walk(path)
      else if (SCORE_EXTENSIONS.some((extension) => name.endsWith(extension))) found.push(path)
    }
  }
  for (const directory of directories) walk(resolve(directory))
  return found.sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The first place two JSON values differ, walking objects in the base's key
 * order and arrays by index. Nothing where they are equal.
 */
export function firstDifference(base: unknown, current: unknown, at = '$'): Difference | undefined {
  if (Array.isArray(base) && Array.isArray(current)) {
    for (let index = 0; index < Math.max(base.length, current.length); index++) {
      const here = `${at}[${String(index)}]`
      if (index >= base.length || index >= current.length) {
        return { at: here, base: base[index], current: current[index] }
      }
      const found = firstDifference(base[index], current[index], here)
      if (found) return found
    }
    return undefined
  }
  if (isRecord(base) && isRecord(current)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
      const here = `${at}.${key}`
      if (!Object.hasOwn(base, key) || !Object.hasOwn(current, key)) {
        return { at: here, base: base[key], current: current[key] }
      }
      const found = firstDifference(base[key], current[key], here)
      if (found) return found
    }
    return undefined
  }
  return Object.is(base, current) ? undefined : { at, base, current }
}

/**
 * What one build makes of one file, as the JSON a caller would see. A
 * refusal is kept by its message, which older builds state without a
 * separate detail.
 */
export function outcomeOf(library: Library, input: Uint8Array, options: CompareOptions): unknown {
  let outcome: unknown
  try {
    const { mnx, warnings } = library.convertMusicXML(input)
    outcome = options.mnxOnly
      ? { mnx }
      : {
          mnx,
          warnings: options.ignoreMessages
            ? warnings.map(({ message: _message, ...rest }) => rest)
            : warnings,
        }
  } catch (error) {
    if (error instanceof library.MusicXMLError) {
      outcome = { refused: { message: error.message, path: error.path, line: error.line } }
    } else {
      outcome = { crashed: error instanceof Error ? `${error.name}: ${error.message}` : error }
    }
  }
  return JSON.parse(JSON.stringify(outcome)) as unknown
}

/** Converts each file with both library modules and returns where they differ. */
export async function compareFiles(
  baseModule: string,
  currentModule: string,
  files: readonly string[],
  options: CompareOptions,
): Promise<FileDifference[]> {
  const base = (await import(pathToFileURL(baseModule).href)) as Library
  const current = (await import(pathToFileURL(currentModule).href)) as Library
  const differences: FileDifference[] = []
  for (const file of files) {
    const input = new Uint8Array(readFileSync(file))
    const found = firstDifference(
      outcomeOf(base, input, options),
      outcomeOf(current, input, options),
    )
    if (found) differences.push({ file, ...found })
  }
  return differences
}

interface WorkerTask {
  kind: 'compare-output'
  baseModule: string
  currentModule: string
  files: string[]
  options: CompareOptions
}

function compareInWorkers(
  baseModule: string,
  currentModule: string,
  files: readonly string[],
  options: CompareOptions,
): Promise<FileDifference[]> {
  const count = Math.max(
    1,
    Math.min(
      availableParallelism(),
      files.length,
      Math.floor(process.availableMemory() / WORKER_MEMORY_BYTES),
    ),
  )
  const shares = Array.from({ length: count }, (_, share) =>
    files.filter((_file, index) => index % count === share),
  )
  return Promise.all(
    shares.map(
      (share) =>
        new Promise<FileDifference[]>((done, fail) => {
          const task: WorkerTask = {
            kind: 'compare-output',
            baseModule,
            currentModule,
            files: share,
            options,
          }
          const worker = new Worker(new URL(import.meta.url), {
            workerData: task,
            resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
          })
          worker.once('message', done)
          worker.once('error', fail)
          // After a message this settles nothing.
          worker.once('exit', (code) => {
            fail(new Error(`A worker exited with code ${String(code)} before it reported.`))
          })
        }),
    ),
  ).then((all) => all.flat().sort((a, b) => a.file.localeCompare(b.file)))
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

/** Whether the lockfile in the working tree differs from the one at the commit. */
function lockfileDiffers(repository: string, commit: string): boolean {
  try {
    git(repository, ['diff', '--quiet', commit, '--', 'pnpm-lock.yaml'])
    return false
  } catch {
    return true
  }
}

/** Builds the library in `root` into `outDir`, and returns the built module. */
function buildLibrary(root: string, outDir: string): string {
  execFileSync(
    join(root, 'node_modules', '.bin', 'vite'),
    ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: root, stdio: 'inherit' },
  )
  // The bundle's name has changed over the project's history.
  const built = readdirSync(outDir).filter((name) => name.endsWith('.js'))
  if (built.length !== 1) {
    throw new Error(`The build in ${root} wrote ${String(built.length)} modules, not one.`)
  }
  return join(outDir, built[0]!)
}

/**
 * Builds the library at a commit, in a worktree that shares this checkout's
 * node_modules. The worktree is removed afterwards, also after an interrupt:
 * the handlers below keep Node alive until the build stops and the cleanup
 * has run.
 */
function buildLibraryAt(repository: string, commit: string, outDir: string): string {
  const tree = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-base-'))
  const modules = join(tree, 'node_modules')
  const interrupted = (): void => {
    process.exitCode = 2
  }
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)
  try {
    git(repository, ['worktree', 'add', '--detach', tree, commit])
    symlinkSync(join(repository, 'node_modules'), modules)
    return buildLibrary(tree, outDir)
  } finally {
    // Removes the link alone, not the node_modules it points at.
    rmSync(modules, { force: true })
    try {
      git(repository, ['worktree', 'remove', '--force', tree])
    } catch {
      // The worktree was never added. The directory is removed below.
    }
    rmSync(tree, { recursive: true, force: true })
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
  }
}

function shown(value: unknown): string {
  const text = value === undefined ? '(nothing)' : JSON.stringify(value)
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'mnx-only': { type: 'boolean', default: false },
      'ignore-messages': { type: 'boolean', default: false },
    },
  })
  const [ref, ...directories] = positionals
  if (ref === undefined) {
    console.error(
      'Usage: node scripts/compare-output.ts <base-ref> [--mnx-only] [--ignore-messages] [directory...]',
    )
    return 2
  }
  const options: CompareOptions = {
    mnxOnly: values['mnx-only'],
    ignoreMessages: values['ignore-messages'],
  }

  const repository = fileURLToPath(new URL('..', import.meta.url))
  const files = scoreFiles(
    directories.length > 0 ? directories : [join(repository, 'tests/corpus')],
  )
  if (files.length === 0) {
    console.error('No score files were found to compare.')
    return 2
  }
  const commit = git(repository, ['rev-parse', '--verify', `${ref}^{commit}`])
  if (lockfileDiffers(repository, commit)) {
    console.error(
      `pnpm-lock.yaml differs from ${ref}. Both builds use this checkout's dependencies, ` +
        'so a change in a dependency is not compared.',
    )
  }

  // Inside the repository, so each build finds the runtime dependencies it
  // leaves external.
  const cache = join(repository, 'node_modules', '.cache', 'compare-output')
  const baseModule = buildLibraryAt(repository, commit, join(cache, 'base'))
  const currentModule = buildLibrary(repository, join(cache, 'current'))

  const differences = await compareInWorkers(baseModule, currentModule, files, options)
  for (const { file, at, base, current } of differences) {
    console.log(relative(process.cwd(), file))
    console.log(`  at       ${at}`)
    console.log(`  base     ${shown(base)}`)
    console.log(`  current  ${shown(current)}`)
  }
  console.log(
    differences.length === 0
      ? `All ${String(files.length)} files convert the same as ${ref}.`
      : `${String(differences.length)} of ${String(files.length)} files convert differently from ${ref}.`,
  )
  return differences.length === 0 ? 0 : 1
}

const task = workerData as WorkerTask | undefined
if (!isMainThread && task?.kind === 'compare-output') {
  const { baseModule, currentModule, files, options } = task
  parentPort?.postMessage(await compareFiles(baseModule, currentModule, files, options))
} else if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const code = await main()
    process.exitCode ??= code
  } catch (error) {
    console.error(error)
    process.exitCode = 2
  }
}
