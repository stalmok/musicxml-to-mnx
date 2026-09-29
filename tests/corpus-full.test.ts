// The full-corpus gate.
//
// Converts every MusicXML file under a directory and applies the
// source-independent checks of the vendored corpus test, over the whole
// OpenScore Lieder corpus. It has about 1,500 files and takes minutes, so it
// is skipped unless MUSICXML_TO_MNX_CORPUS names a directory of scores. The
// corpus workflow sets it after it clones the corpus, and a maintainer sets it
// before a release.
//
//   MUSICXML_TO_MNX_CORPUS=<dir> [MUSICXML_TO_MNX_CORPUS_REPORT=<file.json>] pnpm corpus-gate
//
// It fails on a crash, on output the schema rejects, or on output whose notes
// or measure lengths disagree with the source. A file refused with a
// MusicXMLError is reported by reason, not failed. The warnings are counted
// by the element lost.

import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { convertMusicXML, MusicXMLError } from '../src/index.js'
import type { ConversionWarning, MNXDocument } from '../src/index.js'
import { readMusicXML } from '../src/container.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import {
  crowdedMeasureRests,
  measureLengthDisagreements,
  pitchesOf,
  sourceMicrotones,
  sourcePitches,
  underfilledTuplets,
  unsourcedLosses,
} from './support/structural.js'

const corpusDir = process.env.MUSICXML_TO_MNX_CORPUS

interface Failure {
  file: string
  kind: 'crash' | 'schema' | 'pitches' | 'warnings' | 'lengths'
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

/** Converts one file once and applies every check. */
function assess(file: string): Outcome {
  let xml: string
  let mnx
  let warnings
  try {
    xml = readMusicXML(new Uint8Array(readFileSync(file)))
    // eslint-disable-next-line no-restricted-syntax -- a refusal is an outcome here, and assess() checks the schema itself
    ;({ mnx, warnings } = convertMusicXML(xml))
  } catch (error) {
    // A MusicXMLError is a refusal of input the converter cannot convert
    // faithfully. Any other error is a crash.
    if (error instanceof MusicXMLError) {
      // Grouped without the location, which changes when a file is
      // re-exported.
      return { kind: 'refused', reason: error.detail }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { kind: 'failed', failure: { file, kind: 'crash', detail } }
  }

  // Where a note's written value disagrees with its duration, the converter
  // keeps the written value and warns inconsistent:duration. Its measures then
  // add up by written values, so the length check below, which reads the
  // durations, does not apply. The pitch and schema checks still apply.
  const inconsistent = warnings.some((warning) => warning.code === 'inconsistent:duration')

  const failure = firstFailure(file, xml, mnx, warnings, inconsistent)
  if (failure) return { kind: 'failed', failure }

  return { kind: 'converted', losses: warnings.map((warning) => warning.element ?? warning.code) }
}

/** The first check the converted output fails, or nothing when it passes all. */
function firstFailure(
  file: string,
  xml: string,
  mnx: MNXDocument,
  warnings: readonly ConversionWarning[],
  skipLengths: boolean,
): Failure | undefined {
  const schema = schemaErrors(mnx)
  if (schema.length > 0) return { file, kind: 'schema', detail: schema.slice(0, 3).join('; ') }

  // MNX requires a sequence with a rest that fills the measure to have empty
  // content. The schema does not check this.
  const crowded = crowdedMeasureRests(mnx)
  if (crowded.length > 0) {
    return {
      file,
      kind: 'schema',
      detail: `rests its measure and holds content: ${crowded[0] ?? ''}`,
    }
  }

  const root = parseXmlRoot(xml)

  // MNX advances the sequence cursor by a tuplet's outer, and its content must
  // come to inner. The schema cannot check this. A ratio that no pair of note
  // values writes is reported, and the notes are written without the tuplet.
  const underfilled = [...underfilledTuplets(mnx)]
  if (underfilled.length > 0) {
    return {
      file,
      kind: 'schema',
      detail: `holds a tuplet short of what its ratio counts: ${underfilled[0] ?? ''}`,
    }
  }

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

  // MNX states a whole number of semitones, so the source pitches above are
  // read at the whole alteration a microtone converts to. Each such
  // conversion must be reported.
  const microtones = sourceMicrotones(root)
  const reported = warnings.filter((w) => w.code === 'unrepresentable:microtone').length
  if (reported !== microtones) {
    return {
      file,
      kind: 'pitches',
      detail: `${String(reported)} microtones reported against ${String(microtones)} in the source`,
    }
  }

  const unsourced = unsourcedLosses(root, warnings)[0]
  if (unsourced)
    return { file, kind: 'warnings', detail: `names what the source lacks: ${unsourced}` }

  if (skipLengths) return undefined

  const disagreement = measureLengthDisagreements(mnx, root, warnings)[0]
  if (disagreement) return { file, kind: 'lengths', detail: disagreement }

  return undefined
}

function largestFirst(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1])
}

const gate = corpusDir ? describe : describe.skip

gate('the full corpus', () => {
  // A skipped block still runs its body, so the walk needs a directory.
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

  // Printed, not asserted: how many files converted, how many were refused,
  // and what was lost by element. The report file holds the same data.
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

  if (process.env.MUSICXML_TO_MNX_CORPUS_REPORT !== undefined) {
    writeFileSync(
      process.env.MUSICXML_TO_MNX_CORPUS_REPORT,
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

  // Every file converts to output that matches the source, or is refused for
  // a stated reason. The first several failures are shown. The report file
  // has them all.
  test('converts the whole corpus without a crash or a mismatch', () => {
    expect(failures.slice(0, 20)).toEqual([])
  })
})
