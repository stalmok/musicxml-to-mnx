// The full-corpus gate.
//
// Runs every MusicXML file under a directory through the converter and holds
// the output to the same source-independent checks the vendored corpus test
// applies to its songs, over the whole of the OpenScore Lieder corpus rather
// than a sample. It is not run per commit: it fetches ~1,500 files and takes
// minutes, so it stays skipped unless OSSIA_CORPUS points at a directory of
// scores, which the corpus workflow sets after cloning the corpus and a
// maintainer sets before a release.
//
//   OSSIA_CORPUS=<dir> [OSSIA_CORPUS_REPORT=<file.json>] pnpm corpus-gate
//
// It fails on a crash, on output the schema rejects, or on output whose notes
// or measure lengths disagree with the source. A file the converter refuses
// with a MusicXMLError is a deliberate rejection, not a crash, so it is
// reported by reason rather than failed. The warnings are aggregated by the
// element lost, which is the feedback worth handing the Community Group: how
// much of a real corpus each unconvertible construct accounts for.

import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { MNXDocument } from '../src/index.js'
import { readMusicXML } from '../src/container.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import { pitchesOf, sounding, sourceMeasureLengths, sourcePitches } from './support/structural.js'

const corpusDir = process.env.OSSIA_CORPUS

interface Failure {
  file: string
  kind: 'crash' | 'schema' | 'pitches' | 'lengths'
  detail: string
}

type Outcome =
  | { kind: 'converted'; losses: readonly string[] }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; failure: Failure }

/** Every MusicXML file under a directory, in a stable order. */
function inputsUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...inputsUnder(path))
    else if (/\.(mxl|musicxml|xml)$/i.test(entry.name)) found.push(path)
  }
  return found.sort()
}

/** One file, converted once and held to every check. */
function assess(file: string): Outcome {
  let xml: string
  let mnx
  let warnings
  try {
    xml = readMusicXML(new Uint8Array(readFileSync(file)))
    ;({ mnx, warnings } = convertMusicXML(xml))
  } catch (error) {
    // A MusicXMLError is the converter deliberately refusing input it cannot
    // convert faithfully, which is not a failure of the gate; anything else
    // escaping is a crash, which is.
    if (error instanceof MusicXMLError) {
      // Grouped without the location, which moves whenever a file is
      // re-exported.
      return { kind: 'refused', reason: error.detail }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { kind: 'failed', failure: { file, kind: 'crash', detail } }
  }

  // Where a note's written value disagrees with its measured duration, the
  // converter deliberately carries the written value and says so with an
  // inconsistent:duration warning. Its measures then sound as the written
  // values do, not as the source's durations add up, so the length check
  // below, which reads those durations, would compare against the wrong
  // thing. The pitch and schema checks still hold that file to account.
  const inconsistent = warnings.some((warning) => warning.code === 'inconsistent:duration')

  const failure = firstFailure(file, xml, mnx, inconsistent)
  if (failure) return { kind: 'failed', failure }

  return { kind: 'converted', losses: warnings.map((warning) => warning.element ?? warning.code) }
}

/** The first check the converted output fails, or nothing when it passes all. */
function firstFailure(
  file: string,
  xml: string,
  mnx: MNXDocument,
  skipLengths: boolean,
): Failure | undefined {
  const schema = schemaErrors(mnx)
  if (schema.length > 0) return { file, kind: 'schema', detail: schema.slice(0, 3).join('; ') }

  const root = parseXmlRoot(xml)

  const converted = pitchesOf(mnx)
  const inSource = sourcePitches(root)
  if (converted.length !== inSource.length || converted.some((p, i) => p !== inSource[i])) {
    const at = converted.findIndex((p, i) => p !== inSource[i])
    return {
      file,
      kind: 'pitches',
      detail:
        at === -1
          ? `${String(converted.length)} measure lines against ${String(inSource.length)} in the source`
          : `"${converted[at] ?? ''}" against "${inSource[at] ?? ''}" in the source`,
    }
  }

  if (skipLengths) return undefined

  const lengths = sourceMeasureLengths(root)
  for (const [partIndex, part] of mnx.parts.entries()) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      // A full-measure rest states no length of its own; the time signature
      // does, and this check is about what the converter carried over.
      if (measure.sequences.some((sequence) => sequence.fullMeasure)) continue

      const soundsFor = Math.max(
        0,
        ...measure.sequences.map((sequence) =>
          sequence.content.reduce((sum, item) => sum + sounding(item), 0),
        ),
      )
      const source = lengths[partIndex]?.[measureIndex] ?? 0
      if (Math.abs(soundsFor - source) > 1e-9) {
        return {
          file,
          kind: 'lengths',
          detail:
            `part ${String(partIndex + 1)} measure ${String(measureIndex + 1)}: ` +
            `${String(soundsFor)} against ${String(source)} in the source`,
        }
      }
    }
  }

  return undefined
}

function largestFirst(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1])
}

// Skipped unless a corpus directory is given, so an ordinary test run does not
// try to convert files that are not there.
const gate = corpusDir ? describe : describe.skip

gate('the full corpus', () => {
  // Guarded, so the body walking a directory cannot throw when there is none
  // to walk and the whole block is skipped.
  const files = corpusDir ? inputsUnder(corpusDir) : []

  const failures: Failure[] = []
  const refusals = new Map<string, number>()
  const losses = new Map<string, number>()
  let converted = 0

  for (const file of files) {
    const outcome = assess(file)
    if (outcome.kind === 'failed') {
      failures.push(outcome.failure)
    } else if (outcome.kind === 'refused') {
      refusals.set(outcome.reason, (refusals.get(outcome.reason) ?? 0) + 1)
    } else {
      converted += 1
      for (const element of outcome.losses) losses.set(element, (losses.get(element) ?? 0) + 1)
    }
  }

  // Printed rather than asserted: how a real corpus divides into converted,
  // deliberately refused, and lost-by-element is the feedback worth reading,
  // and the report file carries the same for a machine.
  const refused = [...refusals.values()].reduce((sum, count) => sum + count, 0)
  const lines = [
    `${String(files.length)} files: ${String(converted)} converted, ${String(refused)} refused, ${String(failures.length)} failed.`,
    '',
    'Refused, by reason:',
    ...largestFirst(refusals).map(([reason, n]) => `  ${String(n).padStart(6)}  ${reason}`),
    '',
    'Lost, by element:',
    ...largestFirst(losses).map(([element, n]) => `  ${String(n).padStart(6)}  <${element}>`),
  ]
  console.log(lines.join('\n'))

  if (process.env.OSSIA_CORPUS_REPORT !== undefined) {
    writeFileSync(
      process.env.OSSIA_CORPUS_REPORT,
      `${JSON.stringify(
        {
          total: files.length,
          converted,
          refusals: Object.fromEntries(refusals),
          losses: Object.fromEntries(losses),
          failures,
        },
        null,
        2,
      )}\n`,
    )
  }

  test('has files to convert', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  // Every file either converts to output that matches the source, or is
  // refused for a stated reason. Nothing crashes, produces illegal MNX, or
  // hands back different notes or a different length from what the source
  // wrote. The first several failures are shown; the report file has them all.
  test('converts the whole corpus without a crash or a mismatch', () => {
    expect(failures.slice(0, 20)).toEqual([])
  })
})
