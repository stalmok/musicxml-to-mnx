// Checks that what spans measures stays inside the score and apart from its
// own kind, and that no sequence runs past the time signature in force. The
// schema checks the shape of each object, not where it reaches.

import type { MNXDocument } from '../../src/index.js'
import { sounding } from './structural.js'

const SETTLED = 1e-9

/** Each id the document gives more than one object, with how many hold it. */
export function duplicateIds(mnx: MNXDocument): string[] {
  const counts = new Map<string, number>()
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return
    if (!Array.isArray(value) && 'id' in value && typeof value.id === 'string') {
      counts.set(value.id, (counts.get(value.id) ?? 0) + 1)
    }
    for (const inner of Object.values(value)) visit(inner)
  }
  visit(mnx)
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `${String(count)} objects hold id "${id}"`)
}

interface Run {
  readonly what: string
  readonly start: number
  readonly measures: number
}

// Where a run of measures reaches past the last measure, or starts inside
// the run before it.
function misplacedRuns(runs: readonly Run[], count: number): string[] {
  const found: string[] = []
  const ordered = [...runs].sort((one, other) => one.start - other.start)
  ordered.forEach((run, index) => {
    const end = run.start + run.measures
    if (end > count) {
      found.push(`${run.what} runs to measure ${String(end)} of ${String(count)}`)
    }
    const before = ordered[index - 1]
    if (before && run.start < before.start + before.measures) {
      found.push(`${run.what} starts inside ${before.what}`)
    }
  })
  return found
}

/** Each ending that runs past the score, or starts inside the one before it. */
export function misplacedEndings(mnx: MNXDocument): string[] {
  const { measures } = mnx.global
  const runs = measures.flatMap(({ ending }, index) =>
    ending
      ? [
          {
            what: `the ending in measure ${String(index + 1)}`,
            start: index,
            measures: ending.duration,
          },
        ]
      : [],
  )
  return misplacedRuns(runs, measures.length)
}

/**
 * Each multi-measure rest that runs past the score, or starts inside the one
 * before it in the same score. A rest whose start leads nowhere is reported
 * by danglingReferences.
 */
export function misplacedMultimeasureRests(mnx: MNXDocument): string[] {
  const { measures } = mnx.global
  const indexOf = new Map(measures.flatMap(({ id }, index) => (id ? [[id, index]] : [])))
  return (mnx.scores ?? []).flatMap((score, scoreIndex) => {
    const runs = (score.multimeasureRests ?? []).flatMap((rest) => {
      const start = indexOf.get(rest.start)
      if (start === undefined) return []
      const what = `score ${String(scoreIndex + 1)} rest in measure ${String(start + 1)}`
      return [{ what, start, measures: rest.duration }]
    })
    return misplacedRuns(runs, measures.length)
  })
}

/**
 * Each sequence that runs past the time signature in force, which MNX treats
 * as an error. A measure with no time signature in force has no length to
 * hold it to.
 */
export function sequencesPastTime(mnx: MNXDocument): string[] {
  let inForce: number | undefined
  const lengths = mnx.global.measures.map(({ time }) =>
    time ? (inForce = time.count / time.unit) : inForce,
  )
  const found: string[] = []
  for (const [partIndex, part] of mnx.parts.entries()) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      const length = lengths[measureIndex]
      if (length === undefined) continue
      for (const [sequenceIndex, sequence] of measure.sequences.entries()) {
        const lasts = sequence.content.reduce((sum, item) => sum + sounding(item), 0)
        if (lasts <= length + SETTLED) continue
        found.push(
          `part ${String(partIndex + 1)} measure ${String(measureIndex + 1)} sequence ` +
            `${String(sequenceIndex + 1)} lasts ${String(lasts)} of ${String(length)}`,
        )
      }
    }
  }
  return found
}
