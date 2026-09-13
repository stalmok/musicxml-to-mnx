// Real songs, converted on every run.
//
// This is the gate that has actually found things. The unit tests exercise
// one construct at a time, and every defect that reached them lived in a
// combination: a chord member inside a tuplet, a grace note in the cursor's
// path, a note carrying two <notations> blocks. Published music is full of
// those, and none of them appears in a hand-written fixture unless you
// already know to write it.
//
// Four checks, in increasing order of how much they can tell you:
//   1. it converts at all
//   2. the output is legal MNX
//   3. the arithmetic works out, measure by measure
//   4. the notes and the time still match the source
//
// The fourth is the strongest, because it reads the source independently of
// the converter's own reading of it. The other three can all pass on output
// that says the wrong thing about the music.

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
  lyricPlaces,
  measuresWarned,
  pitchesOf,
  sounding,
  slurSpans,
  sourceMeasureLengths,
  sourceLyricPlaces,
  sourcePitches,
  sourceSlurSpans,
  crowdedMeasureRests,
  undefinedKeys,
} from './support/structural.js'
import baseline from './corpus/warning-baseline.json' with { type: 'json' }

/**
 * What a refusal says, without the location, which moves whenever a file is
 * re-exported.
 */
function refusalText(error: MusicXMLError): string {
  return error.detail
}

/**
 * Converted once each, up front. Every check below reads the same result,
 * rather than converting the same song six times over.
 *
 * A MusicXMLError is a refusal the converter chose; anything else is a crash,
 * and the two are held apart because a crash recorded as a refusal reads as a
 * song the converter decided against. A run once reported one refusal more
 * than the tree refuses, on a machine short of memory, and an allocation
 * failure inside a conversion would have looked exactly like that.
 */
const attempted = songs().map((song) => {
  try {
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

// A warning is only worth having if a reader can find what it is about. Every
// one names the line the element was written on, except where the mark has
// already been read into the model and the element it came from is gone: the
// four below work on model objects and name the measure and stop there.
// Three are settled once the parts are merged; the clef is settled inside one
// part, and is the one of the four that could carry a line, by holding it on
// the model's clef the way an ending's edge now holds one.
//
// The list is held both ways, by the per-song check below and by the whole-
// corpus one beside it: a report that names no line and is not listed fails,
// and so does an entry the corpus no longer reaches, which is the shrink
// worth hearing about. Other reports in score.ts are lineless for the same
// reason and are deliberately not listed, because no vendored song reaches
// them; one that starts to will fail here, and be added with its reason or
// given a line.
const REPORTED_WITHOUT_A_LINE: ReadonlySet<string> = new Set([
  'unrepresentable:cross-part-key',
  'unrepresentable:cross-part-time',
  'inconsistent:tempo',
  'unrepresentable:clef',
])

// The other half of the rule above. The per-song check lets a code stay in
// the list after it stops being reached, or after it grows a line; this says
// the list is exactly what the corpus reports without one.
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

// A song is refused only where converting it would mean handing back music
// the source did not write. Which songs those are is pinned here, so that one
// starting or ceasing to convert is a change somebody chose.
// A crash is not a refusal. Nothing in the corpus may throw anything but a
// MusicXMLError, and one that does names itself here rather than joining the
// refusals, where it would read as a song the converter decided against.
test('converts every song without crashing', () => {
  const crashed = attempted
    .filter((song) => song.crashed !== undefined)
    .map((song) => `${song.name}: ${song.crashed ?? ''}`)

  expect(crashed).toEqual([])
})

test('refuses only the songs it is known to refuse', () => {
  const refused = attempted
    .filter((song) => song.rejected !== undefined)
    .map((song) => `${song.name}: ${song.rejected ?? ''}`)

  expect(refused.sort()).toEqual([])
})

/**
 * Every hairpin in the source, paired the way the music has them rather than
 * the way the document writes them: by measure, then by where in the measure
 * the cursor had reached, with a stop closing the most recently opened of its
 * number on its own staff. Read straight from the XML, so it disagrees with
 * the converter when the converter is wrong.
 *
 * The staff belongs in the pairing because 17 songs of the corpus hold both
 * hands' hairpins numbered 1 at once. On the number alone, a stop on one hand
 * closes the other hand's hairpin: in brahms-1-gestillte-sehnsucht the left
 * hand's crescendo, opened partway through measure 7, was closed by the right
 * hand's stop half a beat later, and the right hand's diminuendo ran on to
 * the left hand's stop a measure further. Pairing on the staff as well moves
 * the end of 20 hairpins, across 9 of the songs.
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

      // Paired with a stack per number, then reported in the order the starts
      // appear in the score, which is the order the converted list is in.
      const open = new Map<string, End[]>()
      const closed = new Map<number, End>()
      for (const end of inTime) {
        if (end.kind === 'start') {
          open.set(end.number, [...(open.get(end.number) ?? []), end])
          continue
        }
        // The last one opened on the stop's own staff, or failing that the
        // last one opened at all, since a source that names the staff on one
        // end and not the other means the end that names it.
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
 * Every octave shift in the source, paired the way the music has them: the
 * same walk sourceHairpins does, over <octave-shift> instead of <wedge>. Both
 * spanners pair through one stack in the converter, so the crossed pairing the
 * hairpin oracle caught was live here with nothing able to see it.
 *
 * Each is reported as the octaves MNX states, the measure and point it starts
 * at, and the measure it ends in. MNX requires a shift to say where it stops,
 * so one the source never closes is written nowhere and is left out here too.
 */
function sourceOttavaSpans(root: XmlElement): string[] {
  // The octaves MNX states for each MusicXML size and direction. Written out
  // here rather than read from the converter, which is the point of an oracle:
  // MusicXML's type is which way the notes were moved to draw them, and MNX's
  // value is how far the drawn pitch sits below the sounded one, so 8va is a
  // shift "down" and a value of 1.
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
        // The last one opened on the stop's own staff, or failing that the
        // last one opened at all, exactly as a hairpin pairs.
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
 * Every <other-dynamics> wording in the source, trimmed the way the reader
 * trims it, in document order. Whitespace-only ones are left out: they draw
 * nothing, so there is nothing for the output to carry.
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
 * arpeggio or span end names an event, note or measure by id, and the writer
 * emits an id only where something points at it. A reference with no definition
 * therefore means the writer pointed at an id from a place its id survey does
 * not know to name, so the id was never written. Collected by field name, so a
 * new kind of reference is caught the moment it reuses one of them.
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

  // Nothing else compares a warning's position: every assertion in the suite
  // compares the message and the code, so a report could name no line in
  // every file the reader has and the suite would stay green. The line is
  // held to the document's length rather than to the element it names, so
  // this catches a report with no line and not one with the wrong line.
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

  // MNX reads an absent key and one set to undefined as different things, and
  // the writer builds every optional key conditionally. Nothing else here
  // tells the two apart: the schema passes over such a key, a comparison
  // passes over it, and JSON.stringify drops it, so the emitted text is the
  // same and the document a consumer reads is not.
  test('states no key as undefined', () => {
    expect(undefinedKeys(mnx)).toEqual([])
  })

  // MNX states a rest filling the measure on the sequence, whose content must
  // then be empty. The schema does not carry that rule, so a sequence saying
  // both passes validation and says two things at once.
  test('holds nothing in a sequence that rests its measure', () => {
    expect(crowdedMeasureRests(mnx)).toEqual([])
  })

  // The writer names an event, note or measure only where something points at
  // it, off a survey of where ids are pointed from. A reference with no
  // definition means that survey missed a place, so the id was never written.
  test('names every id it points at', () => {
    const { defined, referenced } = idReferences(mnx)
    const dangling = [...referenced].filter((id) => !defined.has(id))

    expect(dangling).toEqual([])
  })

  // A voice may legitimately stop before the barline, so being short is fine.
  // Running past the end is not: it means time was invented.
  //
  // Measured against the source's own measure rather than the time signature,
  // because real scores contain measures that do not match it. One song here
  // writes five quarters in a 3/4 bar, and the converter carrying that over
  // faithfully is right.
  test('never writes a voice past the end of its measure', () => {
    // A note whose written value exceeds its measured duration is carried as
    // the written value and reported as inconsistent:duration. Its voice then
    // sounds longer than the source's durations add up to, without any time
    // being invented, so this check would be comparing against the wrong
    // thing, just as the exact-length check below is. The pitch and schema
    // checks still hold the song to account.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const root = parseXmlRoot(source)
    const lengths = sourceMeasureLengths(root)
    // A tuplet whose content disagrees with its ratio stands as the source
    // drew it, and occupies its outer whatever it holds, so its measure sounds
    // longer than the source's durations add up to. Only the measure the
    // report names is passed over.
    const misfitting = measuresWarned(root, warnings, 'inconsistent:tuplet')
    const overfull: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        const inSource = lengths[partIndex]?.[index] ?? 0
        if (misfitting.has(`${String(partIndex)}:${String(index)}`)) return

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

  // A beam, tie or slur names what it joins, and MNX writes an id only where
  // something names it. A reference with no named event behind it is a broken
  // document that the schema cannot see, since it checks the shape of an id
  // and not whether it leads anywhere.
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
            // A let-ring tie has no target, so there is nothing to reference.
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

  // Each part's measures line up with the global measure list by position, so
  // a part holding a different number of them falls silent partway through the
  // score or runs past its end. The schema types a part's measures as a plain
  // list, so a short one is a well-formed document saying the wrong thing.
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
  // The pairing itself is read back out of the source here, following the
  // cursor by hand, because pairing the two ends in the order the document
  // writes them is wrong: a measure holding two voices is written as one pass
  // per voice with a <backup> between them, so a stop belonging to the first
  // voice is written before a start belonging to the second. Doing it that way
  // made six hairpins out of ends that had nothing to do with each other, one
  // of them 28 measures long, and every one of them ran forwards to a measure
  // that existed, so nothing short of this noticed.
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

  // The wording a source wraps a dynamic in becomes that mark's prefix or
  // suffix. Read back out of the source, because the unit tests only exercise
  // blocks somebody thought to write down, and 851 of these are spread across
  // the corpus in shapes nobody chose.
  //
  // Each wording has to turn up in the output or in a warning. Substring
  // rather than equality, because several wordings standing before one mark
  // are joined into a single prefix, and this check should not have an opinion
  // about how they are joined.
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
    // The wording a warning names, not the whole sentence around it, so that
    // an unrelated message mentioning the same letters cannot cover a loss.
    const reported = warnings.flatMap((warning) =>
      [...warning.message.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? ''),
    )

    const lost = sourceWordings(parseXmlRoot(source)).filter(
      (wording) => ![...carried, ...reported].some((text) => text.includes(wording)),
    )

    expect(lost).toEqual([])
    // A wording carried as an empty string says nothing and draws nothing.
    expect(carried.filter((text) => text === '')).toEqual([])
  })

  // The pairing itself, against the source rather than against itself. The
  // check below sees only that a shift runs forwards to a measure that exists,
  // which a shift paired with the wrong end does too: pairing on the staff
  // moved the extent of shifts in two of the corpus's songs, and nothing here
  // could tell. The hairpin oracle caught exactly that for hairpins, and both
  // spanners pair through one stack.
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

    // Sorted, unlike the hairpin comparison above, which holds the order
    // too. A shift's string carries the point it starts at as well as its
    // measure, so two shifts of one part are already told apart by it, and
    // the converted list is in the order the pairing closed them rather than
    // the order the source writes their starts.
    expect(converted.sort()).toEqual(sourceOttavaSpans(parseXmlRoot(source)).sort())
  })

  // An octave shift runs from its position to its end, both of which are
  // places in the score. The schema can check neither that the end names a
  // measure that exists nor that it comes after the start, and a shift that
  // ran backwards would silently draw an 8va over the wrong music.
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

  // A shift's ends name places where an event actually begins, because MNX
  // states them as the first and last events the shift covers. Walking into
  // the tuplets matters: one of the corpus's shifts starts partway through a
  // cadenza run, and a check that treated a tuplet as one lump said the shift
  // began where nothing did.
  test('starts every octave shift on an event', () => {
    // A shift's start is the cursor position the source wrote it at, measured
    // by duration. Where a note's written value disagrees with its duration,
    // the events are placed by their written values, so the two diverge and a
    // shift can begin between events without anything being wrong. Skipped for
    // the same reason the length checks are; the pitch and schema checks hold.
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

  // The other end, held to the same rule. A shift's end is the last event it
  // covers, and the reader moves it back off the point the stop was written
  // at to reach one. An end between events would name a place nothing begins,
  // which the schema reads as legal and a renderer would draw over nothing.
  test('ends every octave shift on an event', () => {
    // Skipped for the reason the start check is: where a note's written value
    // disagrees with its duration, the events are placed by their written
    // values and a shift can end between them with nothing wrong.
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

  // A layout can state less than the part list does and stay legal MNX: a
  // staff with no label reference suppresses its part's name, and a
  // multi-staff part written as bare sibling staves loses its grand staff.
  test('keeps part names and grand staves stated in the layout', () => {
    expect(layoutLosses(mnx)).toEqual([])
  })

  // A staff number that names a staff the part does not have would place
  // music nowhere. The schema types it as a bare integer, so it cannot tell.
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

      // Walked rather than scanned one level deep: an event inside a tuplet
      // or a grace group states its staff the same way, and a note of a
      // chord that reaches across to the other hand states its own.
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

  // The words are the point of a song, so losing or mangling one is not a
  // detail. Compared by the place each syllable is sung and the verse line
  // it belongs to, because the source interleaves the voices of a measure
  // through its cursor, lists a note's verses in any order, and writes a
  // voice's two laid-over lines as one voice while MNX states them as two
  // sequences. Where a syllable is sung is the one thing both sides read the
  // same way, and a syllable moved to another note shows in it.
  test('keeps every lyric syllable the source wrote, on the note that sings it', () => {
    expect(lyricPlaces(mnx).sort()).toEqual(sourceLyricPlaces(parseXmlRoot(source)).sort())
  })

  // The check above keeps one text per line per note, so a note stating one
  // line twice with two different texts would pass it while half of what it
  // says is dropped. No vendored song does that today; one that started to
  // would be a loss to look at rather than to keep quiet about.
  test('states no lyric line twice on one note with different words', () => {
    expect(differingLyricLines(parseXmlRoot(source))).toEqual([])
  })

  // MusicXML draws an accidental exactly where it writes an <accidental>, so
  // the count of shown accidentals in the output must match the count in the
  // source. The schema types accidentalDisplay but cannot count.
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

  // A dynamic or tempo sits at a point in its measure, so its position cannot
  // run past the measure's length. The schema types the position but cannot
  // bound it.
  test('never places a direction past the end of its measure', () => {
    const stray: string[] = []
    const lengths = sourceMeasureLengths(parseXmlRoot(source))
    let time = { count: 4, unit: 4 }

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        time = mnx.global.measures[index]?.time ?? time
        // A direction sits at a cursor position, which advances by the notes'
        // measured durations, so the measure reaches at least that far, and at
        // least its time signature. Its source length is that measured extent,
        // which also holds where the source overfills the bar or where the
        // converter carried a written value shorter than the duration it
        // measured. Bounding by the time signature alone would flag a direction
        // in such a measure as past its end.
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

  test('sounds for as long as the source does, measure by measure', () => {
    const root = parseXmlRoot(source)
    const expected = sourceMeasureLengths(root)
    const disagreements: string[] = []
    // A tuplet whose content disagrees with its ratio stands as the source
    // drew it, and occupies its outer whatever it holds. Only the measure the
    // report names is passed over.
    const misfitting = measuresWarned(root, warnings, 'inconsistent:tuplet')

    // Where a note's written value disagrees with its measured duration, the
    // converter carries the written value and reports it as inconsistent:
    // duration. Its measures then sound as the written values do, not as the
    // source's durations add up, so this check would be comparing against the
    // wrong thing. The pitch and schema checks still hold the song to account.
    const inconsistent = warnings.some((warning) => warning.code === 'inconsistent:duration')

    if (!inconsistent) {
      mnx.parts.forEach((part, partIndex) => {
        part.measures.forEach((measure, index) => {
          // A full-measure rest states no length of its own: the time signature
          // does, and this check is about what the converter carried over.
          if (measure.sequences.some((sequence) => sequence.fullMeasure)) return
          if (misfitting.has(`${String(partIndex)}:${String(index)}`)) return

          const converted = Math.max(
            0,
            ...measure.sequences.map((sequence) =>
              sequence.content.reduce((sum, item) => sum + sounding(item), 0),
            ),
          )
          const inSource = expected[partIndex]?.[index] ?? 0
          if (Math.abs(converted - inSource) > 1e-9) {
            disagreements.push(
              `part ${String(partIndex + 1)} measure ${String(index + 1)}: ` +
                `converted ${String(converted)} against ${String(inSource)} in the source`,
            )
          }
        })
      })
    }

    expect(disagreements.slice(0, 5)).toEqual([])
  })

  // A slur whose two ends sit in one voice is unambiguous in the source: a
  // measure is written one voice at a time, so within a voice the document's
  // order is the music's. Every one of those has to come out joining the same
  // two places. This reads the source on its own, because the pairing is
  // exactly what the converter has to work out, and a slur pointing at the
  // wrong note is legal MNX that no other check here can see.
  test('joins every slur the source states within one voice', () => {
    // Where a written value disagrees with its duration the converter carries
    // the written value, so the events sit where the writing puts them and
    // the source's own durations are no longer the yardstick, exactly as for
    // the measure lengths above. Nine songs are passed over here, and their
    // slurs are held to account by nothing else.
    if (warnings.some((warning) => warning.code === 'inconsistent:duration')) return

    const stated = sourceSlurSpans(parseXmlRoot(source))
    const converted = slurSpans(mnx)
    const missing = [...stated].filter((span) => !converted.has(span))

    expect(missing.slice(0, 5)).toEqual([])
  })

  // Losses may only shrink. A rise means something stopped being converted
  // that used to be; a fall means the baseline is due an update.
  test('loses no more than the recorded baseline', () => {
    // Grouped by the element lost, which the warning states as a field. It
    // used to be dug back out of the message with a regular expression, which
    // made the baseline turn on how a sentence happened to be worded. An
    // attribute loss is keyed as element@attribute, apart from its element's
    // own losses, so one cannot regress inside a drop in the other.
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
