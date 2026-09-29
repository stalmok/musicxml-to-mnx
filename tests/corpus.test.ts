// Real songs, converted on every run. The unit tests cover one construct at a
// time. Real music has combinations: a chord member inside a tuplet, a grace
// note in the cursor's path, a note with two <notations> blocks.
//
// Four checks, from weakest to strongest:
//   1. it converts
//   2. the output is legal MNX
//   3. the arithmetic works out, measure by measure
//   4. the notes and the time still match the source
//
// The fourth reads the source independently of the converter. The other three
// can pass on output that is wrong about the music.

import { describe, expect, test } from 'vitest'
import { MusicXMLError, convertMusicXML } from '../src/index.js'
import type { MNXBeam, MNXSequenceItem } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import { songs } from './support/corpus.js'
import {
  collectStarts,
  differingLyricLines,
  layoutLosses,
  measureLengthDisagreements,
  lyricPlaces,
  pitchesOf,
  sounding,
  slurSpans,
  sourceMeasureLengths,
  sourceLyricPlaces,
  sourcePitches,
  sourceSlurSpans,
  underfilledTuplets,
  crowdedMeasureRests,
  undefinedKeys,
  unsourcedLosses,
} from './support/structural.js'
import baseline from './corpus/warning-baseline.json' with { type: 'json' }

/**
 * What a refusal says, without the location, which changes when a file is
 * re-exported.
 */
function refusalText(error: MusicXMLError): string {
  return error.detail
}

/**
 * Each song is converted once, and every check below reads the result.
 *
 * A MusicXMLError is a refusal. Anything else is a crash, which is kept apart
 * from the refusals, so that an allocation failure does not read as a refused
 * song.
 */
const attempted = songs().map((song) => {
  try {
    // eslint-disable-next-line no-restricted-syntax -- a refusal is an outcome here, and every song is checked against the schema below
    return { ...song, ...convertMusicXML(song.source), rejected: undefined, crashed: undefined }
  } catch (error) {
    if (error instanceof MusicXMLError) {
      return { ...song, rejected: refusalText(error), crashed: undefined }
    }
    return {
      ...song,
      rejected: undefined,
      crashed: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
})

const converted = attempted.filter(
  (song) => song.rejected === undefined && song.crashed === undefined,
)

// Every warning names the line of its element, except where the element is
// already read into the model. The four below work on model objects and name
// only the measure. Three are settled once the parts are merged. The clef is
// settled inside one part, and could carry a line if the model's clef held
// one, as an ending's edge does.
//
// The per-song check below fails on a warning with no line that is not
// listed. The whole-corpus check fails on a listed code the corpus no longer
// reaches. Other warnings in score.ts have no line for the same reason, but
// no vendored song reaches them, so they are not listed.
const REPORTED_WITHOUT_A_LINE: ReadonlySet<string> = new Set([
  'unrepresentable:cross-part-key',
  'unrepresentable:cross-part-time',
  'inconsistent:tempo',
  'unrepresentable:clef',
])

// The list must equal the codes the corpus reports without a line.
test('reports no line only for the losses recorded as having none', () => {
  const found = new Set<string>()
  for (const song of converted) {
    for (const warning of song.warnings) {
      if (warning.context.line === undefined) found.add(warning.code)
    }
  }

  expect([...found].sort()).toEqual([...REPORTED_WITHOUT_A_LINE].sort())
})

test('the whole corpus is present', () => {
  expect(attempted.length).toBe(Object.keys(baseline).length)
  expect(attempted.length).toBeGreaterThan(150)
})

// A crash is not a refusal. Nothing in the corpus may throw anything but a
// MusicXMLError.
test('converts every song without crashing', () => {
  const crashed = attempted
    .filter((song) => song.crashed !== undefined)
    .map((song) => `${song.name}: ${song.crashed ?? ''}`)

  expect(crashed).toEqual([])
})

// A song is refused only where converting it would give music the source did
// not write. The refused songs are listed here, so that a change is visible.
test('refuses only the songs it is known to refuse', () => {
  const refused = attempted
    .filter((song) => song.rejected !== undefined)
    .map((song) => `${song.name}: ${song.rejected ?? ''}`)

  expect(refused.sort()).toEqual([])
})

/**
 * Every hairpin in the source, paired in time order, not document order: by
 * measure, then by cursor position, with a stop closing the most recently
 * opened hairpin of its number on its own staff. Read from the XML
 * independently of the converter.
 *
 * The staff is part of the pairing because some songs have both hands'
 * hairpins numbered 1 at the same time. On the number alone, a stop on one
 * hand closes the other hand's hairpin (brahms-1-gestillte-sehnsucht,
 * measure 7).
 */
function sourceHairpins(root: XmlElement): string[] {
  const paired: string[] = []

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      interface End {
        kind: 'start' | 'stop'
        wedge: string
        number: string
        staff: string
        measure: number
        position: number
        order: number
      }
      const ends: End[] = []
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0')

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
              if (stated) divisions = Number(stated)
            } else if (item.name === 'backup') {
              position -= durationOf()
            } else if (item.name === 'forward') {
              position += durationOf()
            } else if (item.name === 'note') {
              const held =
                item.children.some((c) => c.name === 'chord') ||
                item.children.some((c) => c.name === 'grace')
              if (!held) position += durationOf()
            } else if (item.name === 'direction') {
              const wedge = item.children
                .filter((c) => c.name === 'direction-type')
                .flatMap((c) => c.children)
                .find((c) => c.name === 'wedge')
              if (!wedge) continue

              // The converter moves a direction by its offset, so this must too.
              const offset = Number(
                item.children.find((c) => c.name === 'offset')?.text.trim() ?? '0',
              )
              // Anything else a wedge can be, such as a point partway along
              // one, is not an end and is not converted either.
              const type = wedge.attributes.type ?? ''
              if (type !== 'crescendo' && type !== 'diminuendo' && type !== 'stop') continue

              ends.push({
                kind: type === 'stop' ? 'stop' : 'start',
                wedge: type === 'crescendo' ? 'increasing' : 'decreasing',
                number: wedge.attributes.number ?? '1',
                staff: item.children.find((c) => c.name === 'staff')?.text.trim() ?? '',
                measure: measureIndex,
                position: (position + offset) / (divisions * 4),
                order: ends.length,
              })
            }
          }
        })

      const inTime = [...ends].sort(
        (a, b) =>
          a.measure - b.measure ||
          a.position - b.position ||
          (a.kind === b.kind ? a.order - b.order : a.kind === 'stop' ? -1 : 1),
      )

      // Paired with a stack per number, then reported in the order of the
      // starts in the score, which is the order of the converted list.
      const open = new Map<string, End[]>()
      const closed = new Map<number, End>()
      for (const end of inTime) {
        if (end.kind === 'start') {
          open.set(end.number, [...(open.get(end.number) ?? []), end])
          continue
        }
        // The last one opened on the stop's own staff, or else the last one
        // opened. A source that names the staff on one end only means that
        // end's staff.
        const waiting = open.get(end.number) ?? []
        const sameStaff = waiting.map((one) => one.staff).lastIndexOf(end.staff)
        const started = waiting.splice(sameStaff < 0 ? waiting.length - 1 : sameStaff, 1)[0]
        open.set(end.number, waiting)
        if (started) closed.set(started.order, end)
      }

      for (const end of ends) {
        if (end.kind !== 'start') continue
        const stop = closed.get(end.order)
        paired.push(
          `part ${String(partIndex + 1)} ${end.wedge} m${String(end.measure + 1)} -> ` +
            `${stop ? `m${String(stop.measure + 1)}` : 'open'}`,
        )
      }
    })

  return paired
}

/**
 * Every octave shift in the source, paired in time order: the same walk as
 * sourceHairpins, over <octave-shift> instead of <wedge>. Both spanners pair
 * through one stack in the converter.
 *
 * Each is reported as the octaves MNX states, the measure and point it starts
 * at, and the measure it ends in. MNX requires a shift to state where it
 * stops, so a shift the source never closes is left out.
 */
function sourceOttavaSpans(root: XmlElement): string[] {
  // The octaves MNX states for each MusicXML size and direction. MusicXML's
  // type is which way the notes were moved to draw them. MNX's value is how
  // far the drawn pitch is below the sounded one. So 8va is a shift "down"
  // and a value of 1.
  const octaves = new Map<string, Record<string, number>>([
    ['8', { down: 1, up: -1 }],
    ['15', { down: 2, up: -2 }],
    ['22', { down: 3, up: -3 }],
  ])

  const spans: string[] = []

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      interface End {
        kind: 'start' | 'stop'
        // Absent on a start of a type or size the converter drops, and on
        // every stop. A dropped start still takes its stop out of the stack.
        value: number | undefined
        number: string
        staff: string
        measure: number
        position: number
        order: number
      }
      const ends: End[] = []
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0')

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
              if (stated) divisions = Number(stated)
            } else if (item.name === 'backup') {
              position -= durationOf()
            } else if (item.name === 'forward') {
              position += durationOf()
            } else if (item.name === 'note') {
              const held =
                item.children.some((c) => c.name === 'chord') ||
                item.children.some((c) => c.name === 'grace')
              if (!held) position += durationOf()
            } else if (item.name === 'direction') {
              const shift = item.children
                .filter((c) => c.name === 'direction-type')
                .flatMap((c) => c.children)
                .find((c) => c.name === 'octave-shift')
              if (!shift) continue

              const type = shift.attributes.type ?? ''
              // A "continue" marks a point partway along a shift, which is
              // neither end of one.
              if (type === 'continue') continue

              // The converter moves a direction by its offset, so this must too.
              const offset = Number(
                item.children.find((c) => c.name === 'offset')?.text.trim() ?? '0',
              )
              const size = shift.attributes.size ?? '8'
              ends.push({
                kind: type === 'stop' ? 'stop' : 'start',
                value: octaves.get(size)?.[type],
                number: shift.attributes.number ?? '1',
                staff: item.children.find((c) => c.name === 'staff')?.text.trim() ?? '',
                measure: measureIndex,
                position: (position + offset) / (divisions * 4),
                order: ends.length,
              })
            }
          }
        })

      const inTime = [...ends].sort(
        (a, b) =>
          a.measure - b.measure ||
          a.position - b.position ||
          (a.kind === b.kind ? a.order - b.order : a.kind === 'stop' ? -1 : 1),
      )

      const open = new Map<string, End[]>()
      for (const end of inTime) {
        if (end.kind === 'start') {
          open.set(end.number, [...(open.get(end.number) ?? []), end])
          continue
        }
        // The last one opened on the stop's own staff, or else the last one
        // opened, as a hairpin pairs.
        const waiting = open.get(end.number) ?? []
        const sameStaff = waiting.map((one) => one.staff).lastIndexOf(end.staff)
        const started = waiting.splice(sameStaff < 0 ? waiting.length - 1 : sameStaff, 1)[0]
        open.set(end.number, waiting)
        if (!started || started.value === undefined) continue
        spans.push(
          `part ${String(partIndex + 1)} ${String(started.value)} ` +
            `m${String(started.measure + 1)}@${started.position.toFixed(9)} -> ` +
            `m${String(end.measure + 1)}`,
        )
      }
    })

  return spans
}

/**
 * Every <other-dynamics> wording in the source, trimmed as the reader trims
 * it, in document order. Whitespace-only wordings draw nothing and are left
 * out.
 */
function sourceWordings(root: XmlElement): string[] {
  const found: string[] = []
  const walk = (element: XmlElement): void => {
    if (element.name === 'other-dynamics') {
      const wording = element.text.trim()
      if (wording !== '') found.push(wording)
    }
    for (const child of element.children) walk(child)
  }
  walk(root)
  return found
}

/**
 * Every id the document defines, and every id it points at. A tie, slur, beam,
 * arpeggio or span end names an event, note or measure by id. Collected by
 * field name, so a new kind of reference that reuses a field is caught.
 */
function idReferences(document: unknown): { defined: Set<string>; referenced: Set<string> } {
  const defined = new Set<string>()
  const referenced = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>

    if (typeof record.id === 'string') defined.add(record.id)
    // A tie or slur names its far end; a rhythmic position names its measure.
    if (typeof record.target === 'string') referenced.add(record.target)
    if (typeof record.measure === 'string') referenced.add(record.measure)
    // A beam names the events it runs over.
    if (Array.isArray(record.events)) {
      for (const id of record.events) if (typeof id === 'string') referenced.add(id)
    }
    // An arpeggio names the two notes it runs between.
    if (record.span !== null && typeof record.span === 'object') {
      const span = record.span as Record<string, unknown>
      if (typeof span.start === 'string') referenced.add(span.start)
      if (typeof span.end === 'string') referenced.add(span.end)
    }

    for (const value of Object.values(record)) visit(value)
  }

  visit(document)
  return { defined, referenced }
}

describe.each(converted)('$name', ({ name, source, mnx, warnings }) => {
  test('produces MNX the spec schema accepts', () => {
    expect(schemaErrors(mnx)).toEqual([])
  })

  // Holds every warning's line to the document's length, not to its element,
  // so it catches a missing line but not a wrong one.
  test('names where in the source every loss came from', () => {
    const lines = source.split('\n').length
    const measures = mnx.global.measures.length
    const wrong = warnings
      .filter((warning) => {
        const { line, measure } = warning.context
        if (line === undefined) return !REPORTED_WITHOUT_A_LINE.has(warning.code)
        if (!Number.isInteger(line) || line < 1 || line > lines) return true
        // A warning naming no measure comes from the document's head, before
        // any part begins. One that names a measure names a real one.
        return measure !== undefined && (measure < 1 || measure > measures)
      })
      .map((warning) => `${warning.code} / ${warning.element ?? ''}`)

    expect([...new Set(wrong)]).toEqual([])
  })

  test('names only elements and attributes the source holds', () => {
    expect([...new Set(unsourcedLosses(parseXmlRoot(source), warnings))]).toEqual([])
  })

  // The writer builds every optional key conditionally. The schema, a deep
  // comparison and JSON.stringify all ignore a key set to undefined, but a
  // consumer that reads the object sees the key as present.
  test('states no key as undefined', () => {
    expect(undefinedKeys(mnx)).toEqual([])
  })

  // MNX states a rest filling the measure on the sequence, whose content must
  // then be empty. The schema does not check this.
  test('holds nothing in a sequence that rests its measure', () => {
    expect(crowdedMeasureRests(mnx)).toEqual([])
  })

  // The writer names an event, note or measure only where something points at
  // it. A reference with no definition means the writer missed a place that
  // points at an id.
  test('names every id it points at', () => {
    const { defined, referenced } = idReferences(mnx)
    const dangling = [...referenced].filter((id) => !defined.has(id))

    expect(dangling).toEqual([])
  })

  // A voice may stop before the barline, but it must not run past the end.
  //
  // Measured against the source's own measure, not the time signature. One
  // song here writes five quarters in a 3/4 bar, and the converter keeps them.
  test('never writes a voice past the end of its measure', () => {
    // A note whose written value exceeds its duration keeps the written value
    // and is reported as inconsistent:duration. Its voice then sounds longer
    // than the source's durations add up to, so this check does not apply, as
    // for the exact-length check below.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const lengths = sourceMeasureLengths(parseXmlRoot(source))
    const overfull: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        const inSource = lengths[partIndex]?.[index] ?? 0

        measure.sequences.forEach((sequence, voice) => {
          if (sequence.fullMeasure) return
          const total = sequence.content.reduce((sum, item) => sum + sounding(item), 0)
          if (total > inSource + 1e-9) {
            overfull.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)} voice ` +
                `${String(voice + 1)}: ${String(total)} against ${String(inSource)} in the source`,
            )
          }
        })
      })
    })

    expect(overfull.slice(0, 5)).toEqual([])
  })

  // A beam, tie or slur names what it joins. The schema checks the shape of
  // an id, not whether it leads anywhere.
  test('every reference leads to something named', () => {
    const named = new Set<string>()
    const collect = (items: readonly MNXSequenceItem[]): void => {
      for (const item of items) {
        if (
          'type' in item &&
          (item.type === 'tuplet' || item.type === 'grace' || item.type === 'tremolo')
        ) {
          collect(item.content)
          continue
        }
        if ('id' in item && item.id !== undefined) named.add(item.id)
        if ('notes' in item) {
          for (const note of item.notes ?? []) if (note.id !== undefined) named.add(note.id)
        }
      }
    }

    const referenced: string[] = []
    const fromBeams = (beams: readonly MNXBeam[]): void => {
      for (const beam of beams) {
        referenced.push(...beam.events)
        fromBeams(beam.beams ?? [])
      }
    }
    const fromSpanners = (items: readonly MNXSequenceItem[]): void => {
      for (const item of items) {
        if (
          'type' in item &&
          (item.type === 'tuplet' || item.type === 'grace' || item.type === 'tremolo')
        ) {
          fromSpanners(item.content)
          continue
        }
        if ('slurs' in item) referenced.push(...(item.slurs ?? []).map((slur) => slur.target))
        if ('notes' in item) {
          for (const note of item.notes ?? []) {
            // A let-ring tie has no target.
            referenced.push(
              ...(note.ties ?? []).flatMap((tie) => (tie.target !== undefined ? [tie.target] : [])),
            )
          }
        }
      }
    }

    for (const part of mnx.parts) {
      for (const measure of part.measures) {
        fromBeams(measure.beams ?? [])
        // An arpeggio names the two notes it runs between.
        for (const arpeggio of [...(measure.arpeggios ?? []), ...(measure.nonArpeggios ?? [])]) {
          referenced.push(arpeggio.span.start, arpeggio.span.end)
        }
        for (const sequence of measure.sequences) {
          collect(sequence.content)
          fromSpanners(sequence.content)
        }
      }
    }

    expect(referenced.filter((id) => !named.has(id)).slice(0, 5)).toEqual([])
  })

  // Each part's measures line up with the global measure list by position.
  // The schema cannot check that the counts match.
  test('gives every part as many measures as the score has', () => {
    const expected = mnx.global.measures.length
    const uneven = mnx.parts
      .map((part, index) => ({ index, found: part.measures.length }))
      .filter((part) => part.found !== expected)
      .map((part) => `part ${String(part.index + 1)}: ${String(part.found)} of ${String(expected)}`)

    expect(uneven).toEqual([])
  })

  // A hairpin points at the measure it stops in, by id. The schema checks the
  // shape of an id and not whether it leads anywhere.
  //
  // The pairing is read from the source by following the cursor. Document
  // order is wrong: a measure with two voices is written one voice at a time
  // with a <backup> between them, so a stop of the first voice comes before a
  // start of the second.
  test('pairs every hairpin the way the source does', () => {
    const named = new Map<string, number>()
    mnx.global.measures.forEach((measure, index) => {
      if (measure.id !== undefined) named.set(measure.id, index)
    })

    const converted: string[] = []
    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        for (const dynamic of measure.dynamics ?? []) {
          if (!dynamic.wedgeType) continue
          const endsIn = dynamic.end ? named.get(dynamic.end.measure) : undefined
          converted.push(
            `part ${String(partIndex + 1)} ${dynamic.wedgeType} ` +
              `m${String(index + 1)} -> ${endsIn === undefined ? 'open' : `m${String(endsIn + 1)}`}`,
          )
        }
      })
    })

    expect(converted).toEqual(sourceHairpins(parseXmlRoot(source)))
  })

  // The wording around a dynamic becomes that mark's prefix or suffix. Each
  // wording in the source must be in the output or in a warning. A substring
  // match, because several wordings before one mark are joined into one
  // prefix.
  test('carries or reports every dynamic wording the source writes', () => {
    const carried: string[] = []
    for (const part of mnx.parts) {
      for (const measure of part.measures) {
        for (const dynamic of measure.dynamics ?? []) {
          if (dynamic.prefix !== undefined) carried.push(dynamic.prefix)
          if (dynamic.suffix !== undefined) carried.push(dynamic.suffix)
        }
      }
    }
    // Only the quoted wording in a warning counts, not the whole message.
    const reported = warnings.flatMap((warning) =>
      [...warning.message.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? ''),
    )

    const lost = sourceWordings(parseXmlRoot(source)).filter(
      (wording) => ![...carried, ...reported].some((text) => text.includes(wording)),
    )

    expect(lost).toEqual([])
    expect(carried.filter((text) => text === '')).toEqual([])
  })

  // The pairing, against the source. The check below sees only that a shift
  // runs forwards to a measure that exists, which a shift paired with the
  // wrong end also does.
  test('pairs every octave shift the way the source does', () => {
    const named = new Map<string, number>()
    mnx.global.measures.forEach((measure, index) => {
      if (measure.id !== undefined) named.set(measure.id, index)
    })

    const converted: string[] = []
    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        for (const ottava of measure.ottavas ?? []) {
          const endsIn = named.get(ottava.end.measure)
          const from = ottava.position.fraction[0] / ottava.position.fraction[1]
          converted.push(
            `part ${String(partIndex + 1)} ${String(ottava.value)} ` +
              `m${String(index + 1)}@${from.toFixed(9)} -> ` +
              `m${endsIn === undefined ? '?' : String(endsIn + 1)}`,
          )
        }
      })
    })

    // Sorted, unlike the hairpin comparison above. A shift's string holds its
    // start point as well as its measure, so it is unique within a part. The
    // converted list is in the order the pairing closed the shifts.
    expect(converted.sort()).toEqual(sourceOttavaSpans(parseXmlRoot(source)).sort())
  })

  // The schema cannot check that a shift's end names a measure that exists,
  // or that it comes after the start.
  test('runs every octave shift forwards, to a measure that exists', () => {
    const named = new Map<string, number>()
    mnx.global.measures.forEach((measure, index) => {
      if (measure.id !== undefined) named.set(measure.id, index)
    })

    const wrong: string[] = []
    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        for (const ottava of measure.ottavas ?? []) {
          const where = `part ${String(partIndex + 1)} measure ${String(index + 1)}`
          const endsIn = named.get(ottava.end.measure)

          if (endsIn === undefined) {
            wrong.push(`${where}: ends in "${ottava.end.measure}", which names no measure`)
            continue
          }
          if (endsIn < index) {
            wrong.push(`${where}: ends in measure ${String(endsIn + 1)}, before it starts`)
            continue
          }

          const from = ottava.position.fraction[0] / ottava.position.fraction[1]
          const to = ottava.end.position.fraction[0] / ottava.end.position.fraction[1]
          if (endsIn === index && to < from) {
            wrong.push(`${where}: ends at ${String(to)}, before it starts at ${String(from)}`)
          }
        }
      })
    })

    expect(wrong.slice(0, 5)).toEqual([])
  })

  // MNX states a shift's ends as the first and last events it covers, so each
  // end must be where an event begins. The check walks into tuplets, because
  // one shift in the corpus starts partway through a cadenza run.
  test('starts every octave shift on an event', () => {
    // A shift's start is the cursor position, measured by duration. Where a
    // note's written value disagrees with its duration, the events are placed
    // by their written values, so a correct shift can begin between events.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const stray: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        if ((measure.ottavas ?? []).length === 0) return

        const places = new Set<string>()
        for (const sequence of measure.sequences) collectStarts(sequence.content, 0, 1, places)

        for (const ottava of measure.ottavas ?? []) {
          const from = ottava.position.fraction[0] / ottava.position.fraction[1]
          if (!places.has(from.toFixed(9))) {
            stray.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)}: ` +
                `starts at ${String(from)}, where no event does`,
            )
          }
        }
      })
    })

    expect(stray.slice(0, 5)).toEqual([])
  })

  // A shift's end is the last event it covers. The reader moves it back from
  // the point of the stop to reach one.
  test('ends every octave shift on an event', () => {
    // Skipped for the same reason as the start check.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const named = new Map<string, number>()
    mnx.global.measures.forEach((measure, index) => {
      if (measure.id !== undefined) named.set(measure.id, index)
    })

    const stray: string[] = []
    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        for (const ottava of measure.ottavas ?? []) {
          const endsIn = named.get(ottava.end.measure)
          if (endsIn === undefined) continue
          const closing = part.measures[endsIn]
          if (!closing) continue

          const places = new Set<string>()
          for (const sequence of closing.sequences) collectStarts(sequence.content, 0, 1, places)

          const to = ottava.end.position.fraction[0] / ottava.end.position.fraction[1]
          if (!places.has(to.toFixed(9))) {
            stray.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)}: ` +
                `ends at ${String(to)} of measure ${String(endsIn + 1)}, where no event does`,
            )
          }
        }
      })
    })

    expect(stray.slice(0, 5)).toEqual([])
  })

  // A layout can state less than the part list and stay legal MNX: a staff
  // with no label reference hides its part's name, and a multi-staff part
  // written as bare sibling staves loses its grand staff.
  test('keeps part names and grand staves stated in the layout', () => {
    expect(layoutLosses(mnx)).toEqual([])
  })

  // The schema types a staff number as a bare integer, so it cannot check
  // that the part has that staff.
  test('never names a staff the part does not have', () => {
    const stray: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      const staves = part.staves ?? 1
      const check = (staff: number | undefined, where: string): void => {
        if (staff !== undefined && (staff < 1 || staff > staves)) {
          stray.push(
            `part ${String(partIndex + 1)} ${where}: staff ${String(staff)} of ${String(staves)}`,
          )
        }
      }

      // Walked in depth: an event inside a tuplet or a grace group states its
      // staff, and a cross-staff chord note states its own.
      const walk = (items: readonly MNXSequenceItem[], where: string): void => {
        for (const item of items) {
          if ('content' in item && Array.isArray(item.content)) walk(item.content, where)
          if ('staff' in item) check(item.staff, `${where} event`)
          if ('notes' in item) {
            for (const note of item.notes ?? []) check(note.staff, `${where} note`)
          }
        }
      }

      part.measures.forEach((measure, index) => {
        for (const clef of measure.clefs ?? [])
          check(clef.staff, `measure ${String(index + 1)} clef`)
        for (const sequence of measure.sequences) {
          check(sequence.staff, `measure ${String(index + 1)} sequence`)
          walk(sequence.content, `measure ${String(index + 1)}`)
        }
      })
    })

    expect(stray.slice(0, 5)).toEqual([])
  })

  // Compared by the place each syllable is sung and its verse line. The
  // source interleaves the voices of a measure through its cursor, lists a
  // note's verses in any order, and writes a voice's two laid-over lines as
  // one voice, where MNX has two sequences.
  test('keeps every lyric syllable the source wrote, on the note that sings it', () => {
    expect(lyricPlaces(mnx).sort()).toEqual(sourceLyricPlaces(parseXmlRoot(source)).sort())
  })

  // The check above keeps one text per line per note, so it cannot see a
  // note that states one line twice with different texts.
  test('states no lyric line twice on one note with different words', () => {
    expect(differingLyricLines(parseXmlRoot(source))).toEqual([])
  })

  // MusicXML draws an accidental where it writes an <accidental>, so the
  // output must show the same number of accidentals as the source.
  test('shows exactly the accidentals the source draws', () => {
    let shown = 0
    const walk = (items: readonly MNXSequenceItem[]): void => {
      for (const item of items) {
        if (
          'type' in item &&
          (item.type === 'tuplet' || item.type === 'grace' || item.type === 'tremolo')
        ) {
          walk(item.content)
          continue
        }
        if ('notes' in item) {
          for (const note of item.notes ?? []) if (note.accidentalDisplay?.show) shown++
        }
      }
    }
    for (const part of mnx.parts) {
      for (const measure of part.measures) {
        for (const sequence of measure.sequences) walk(sequence.content)
      }
    }

    let inSource = 0
    const count = (element: XmlElement): void => {
      if (element.name === 'accidental') {
        inSource++
        return
      }
      for (const child of element.children) count(child)
    }
    count(parseXmlRoot(source))

    expect(shown).toBe(inSource)
  })

  // The position of a dynamic or tempo cannot run past the measure's length.
  // The schema cannot check this.
  test('never places a direction past the end of its measure', () => {
    const stray: string[] = []
    const lengths = sourceMeasureLengths(parseXmlRoot(source))
    let time = { count: 4, unit: 4 }

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        time = mnx.global.measures[index]?.time ?? time
        // A direction is at a cursor position, which advances by the notes'
        // durations. The bound is the larger of the source's measured length
        // and the time signature, because a source can overfill the bar.
        const barLength = Math.max(time.count / time.unit, lengths[partIndex]?.[index] ?? 0)
        for (const dynamic of measure.dynamics ?? []) {
          const at = dynamic.position.fraction[0] / dynamic.position.fraction[1]
          if (at > barLength + 1e-9) {
            stray.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)}: dynamic at ${String(at)}`,
            )
          }
        }
      })
    })

    expect(stray.slice(0, 5)).toEqual([])
  })

  test('keeps every pitch the source wrote, in order', () => {
    expect(pitchesOf(mnx)).toEqual(sourcePitches(parseXmlRoot(source)))
  })

  // MNX advances the sequence cursor by a tuplet's outer, and its content must
  // come to inner. The schema checks the shape of a ratio, not the
  // arithmetic.
  test('fills every tuplet it writes', () => {
    expect([...underfilledTuplets(mnx)]).toEqual([])
  })

  test('sounds for as long as the source does, measure by measure', () => {
    // Where a note's written value disagrees with its duration, the converter
    // keeps the written value and warns inconsistent:duration. Its measures
    // then add up by written values, so this check does not apply.
    const inconsistent = warnings.some((warning) => warning.code === 'inconsistent:duration')

    const disagreements = inconsistent
      ? []
      : measureLengthDisagreements(mnx, parseXmlRoot(source), warnings)

    expect(disagreements.slice(0, 5)).toEqual([])
  })

  // A slur with both ends in one voice is unambiguous in the source: a
  // measure is written one voice at a time, so within a voice the document
  // order is the time order. A slur that points at the wrong note is still
  // legal MNX.
  test('joins every slur the source states within one voice', () => {
    // Skipped where a written value disagrees with its duration, as for the
    // measure lengths above. Nine songs are skipped here, and no other check
    // covers their slurs.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const stated = sourceSlurSpans(parseXmlRoot(source))
    const converted = slurSpans(mnx)
    const missing = [...stated].filter((span) => !converted.has(span))

    expect(missing.slice(0, 5)).toEqual([])
  })

  // Losses may only shrink. A fall means the baseline needs an update.
  test('loses no more than the recorded baseline', () => {
    // Grouped by the element lost. An attribute loss is keyed as
    // element@attribute, separate from its element's own losses.
    const counts: Record<string, number> = {}
    for (const warning of warnings) {
      const key =
        warning.attribute !== undefined
          ? `${warning.element ?? ''}@${warning.attribute}`
          : (warning.element ?? warning.code)
      counts[key] = (counts[key] ?? 0) + 1
    }

    const recorded = (baseline as Record<string, Record<string, number>>)[name]
    expect(recorded).toBeDefined()

    const risen = Object.entries(counts).filter(
      ([element, count]) => count > (recorded?.[element] ?? 0),
    )
    expect(risen).toEqual([])
  })
})
