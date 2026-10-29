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
import type { ConversionWarning, MNXDocument, MNXSequenceItem, MNXTime } from '../src/index.js'
import { GLYPH_LETTERS } from '../src/read/directions.js'
import { timesInForce } from '../src/read/signatures.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import {
  danglingReferences,
  jumpsWithoutOneDestination,
  staffNumbersPastParts,
  unorderedLyricLines,
} from './support/references.js'
import { schemaErrors } from './support/schema.js'
import { songs } from './support/corpus.js'
import {
  collectStarts,
  differingLyricLines,
  drawnKeyDisagreements,
  layoutLosses,
  measureLengthDisagreements,
  lyricPlaces,
  pitchesOf,
  sounding,
  slurSpans,
  sourceMeasureLengths,
  sourceLyricPlaces,
  sourcePitches,
  flipLetters,
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

// Every warning names the line of its element, except the one below. It
// compares what the parts state once they are merged, and a part may state
// nothing in the measure, so it names only the measure. Parts in different
// time signatures are reported the same way, but the songs that have them
// run past the score's time signature and are refused.
//
// The per-song check below fails on a warning with no line that is not
// listed. The whole-corpus check fails on a listed code the corpus no longer
// reaches.
const REPORTED_WITHOUT_A_LINE: ReadonlySet<string> = new Set(['unrepresentable:cross-part-key'])

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
// not write, or MNX the format does not allow. The refused songs are listed
// here, so that a change is visible.
test('refuses only the songs it is known to refuse', () => {
  const refused = attempted
    .filter((song) => song.rejected !== undefined)
    .map((song) => `${song.name}: ${song.rejected ?? ''}`)

  expect(refused.sort()).toEqual([
    'bantock-2-the-ghost-road: This measure converts to 27/8 of a whole note, past the 4/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'browne-forever-thine: This measure converts to 5/2 of a whole note, past the 4/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'corder-o-sun-that-wakenest: This measure converts to a dotted whole, past the 4/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'davies-3-a-tragedy: This measure converts to a dotted breve, past the 2/2 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'davies-6-bless-you: This measure converts to 13/8 of a whole note, past the 2/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'german-1-all-the-world-awakes-today: This measure converts to a dotted half, past the 2/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'grandval-1-les-clochettes: This measure converts to a dotted whole, past the 4/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'hodges-dreams: This measure converts to 5/4 of a whole note, past the 3/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'jaell-2-causeries-de-vagues: This measure converts to 9/16 of a whole note, past the 3/8 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'jaell-3-les-petits-oiseaux: This measure converts to 29/12 of a whole note, past the 12/8 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'kinkel-1-das-lied-der-nachtigall: This measure converts to 31/16 of a whole note, past the 6/8 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'paladilhe-les-roses-d-ispahan: This measure converts to 9/8 of a whole note, past the 3/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'parry-1-the-poet-s-song: This measure converts to a dotted whole, past the 4/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'strauss-3-heimliche-aufforderung: This measure converts to a dotted half, past the 2/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'thys-petit-negre: The score has a to-coda jump and draws 3 codas. MNX requires exactly one coda in a score with a to-coda jump.',
    'viardot-les-attraits-vwv-1852: This measure converts to a whole, past the 3/4 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
    'warlock-1-roister-doister: This measure converts to a double-dotted half, past the 6/8 its time signature allows. MNX treats a measure that runs past its time signature as an error.',
  ])
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
 *
 * MNX requires a hairpin to state where it stops, so a hairpin the source
 * never closes is left out.
 */
function sourceHairpins(root: XmlElement): string[] {
  const paired: string[] = []

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      interface End {
        kind: 'start' | 'stop'
        wedge: string
        // The level a crescendo from niente starts at, which MNX states.
        from: string
        number: string
        staff: string
        measure: number
        position: number
        order: number
      }
      const ends: End[] = []
      // The furthest point each measure reaches, which is where its barline is.
      const lengths: number[] = []
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0
          let furthest = 0

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.rawText.trim() ?? '0')

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.rawText.trim()
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
              furthest = Math.max(furthest, position)
            } else if (item.name === 'direction') {
              const wedge = item.children
                .filter((c) => c.name === 'direction-type')
                .flatMap((c) => c.children)
                .find((c) => c.name === 'wedge')
              if (!wedge) continue

              // The converter moves a direction by its offset, so this must too.
              const offset = Number(
                item.children.find((c) => c.name === 'offset')?.rawText.trim() ?? '0',
              )
              // Anything else a wedge can be, such as a point partway along
              // one, is not an end and is not converted either.
              const type = wedge.attributes.type ?? ''
              if (type !== 'crescendo' && type !== 'diminuendo' && type !== 'stop') continue

              ends.push({
                kind: type === 'stop' ? 'stop' : 'start',
                wedge: type === 'crescendo' ? 'increasing' : 'decreasing',
                from: type === 'crescendo' && wedge.attributes.niente === 'yes' ? ' from n' : '',
                number: wedge.attributes.number ?? '1',
                staff: item.children.find((c) => c.name === 'staff')?.rawText.trim() ?? '',
                measure: measureIndex,
                position: (position + offset) / (divisions * 4),
                order: ends.length,
              })
            }
          }
          lengths[measureIndex] = Math.max(furthest, position) / (divisions * 4)
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
      // A stop the source writes just before a start of its number on its
      // staff, at the same instant, is a hairpin of no length. The instant is
      // the same point, or the barline the stop sits on and the first beat
      // after it. Such a pair converts to nothing.
      const noLength = new Set<End>()
      const atInstant = (start: End, stop: End) =>
        start.kind === 'start' &&
        start.number === stop.number &&
        start.staff === stop.staff &&
        (start.measure === stop.measure
          ? start.position === stop.position
          : start.measure === stop.measure + 1 &&
            start.position === 0 &&
            stop.position === lengths[stop.measure])
      inTime.forEach((end, index) => {
        if (end.kind === 'start') {
          if (!noLength.has(end)) open.set(end.number, [...(open.get(end.number) ?? []), end])
          return
        }
        // The last one opened on the stop's own staff, or else a start at the
        // stop's instant where every open one names another staff, or else the
        // last one opened. A source that names the staff on one end only means
        // that end's staff.
        const waiting = open.get(end.number) ?? []
        const sameStaff = waiting.map((one) => one.staff).lastIndexOf(end.staff)
        const elsewhere = waiting.every(
          (one) => one.staff !== '' && end.staff !== '' && one.staff !== end.staff,
        )
        if (sameStaff < 0 && elsewhere) {
          const beside = inTime
            .slice(index + 1)
            .find((later) => !noLength.has(later) && atInstant(later, end))
          if (beside) {
            noLength.add(beside)
            return
          }
        }
        const started = waiting.splice(sameStaff < 0 ? waiting.length - 1 : sameStaff, 1)[0]
        open.set(end.number, waiting)
        if (started) closed.set(started.order, end)
      })

      for (const end of ends) {
        if (end.kind !== 'start') continue
        const stop = closed.get(end.order)
        if (!stop) continue
        paired.push(
          `part ${String(partIndex + 1)} ${end.wedge}${end.from} m${String(end.measure + 1)} -> ` +
            `m${String(stop.measure + 1)}`,
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
              Number(item.children.find((c) => c.name === 'duration')?.rawText.trim() ?? '0')

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.rawText.trim()
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
                item.children.find((c) => c.name === 'offset')?.rawText.trim() ?? '0',
              )
              const size = shift.attributes.size ?? '8'
              ends.push({
                kind: type === 'stop' ? 'stop' : 'start',
                value: octaves.get(size)?.[type],
                number: shift.attributes.number ?? '1',
                staff: item.children.find((c) => c.name === 'staff')?.rawText.trim() ?? '',
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

// The MusicXML elements for a dynamic mark that convert: every level MNX
// states, and the accents MusicXML has an element for.
const MARK_ELEMENTS = new Set([
  'pppppp',
  'ppppp',
  'pppp',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'ffff',
  'fffff',
  'ffffff',
  'n',
  'sf',
  'sfz',
  'fz',
  'rf',
  'rfz',
  'sffz',
  'fp',
  'sfp',
  'sfpp',
  'sfzp',
])

// A mark MusicXML spells by combining the pieces of one <dynamics>, as s and
// f for sf. A pattern here rather than the reader's table, so a run of
// pieces read as a mark is held against a second statement of the spellings.
const PLAIN_MARK = /^(p{1,6}|mp|mf|f{1,6}|n)$/
const ACCENT_MARK = /^[sr]?f{1,6}z?(p{1,6}|mp|mf)?$/

/**
 * The letters a piece draws as a SMuFL glyph alone, with no text, or nothing
 * where it is not such a piece or its glyph draws no letters.
 */
function glyphLetters(piece: XmlElement): string | undefined {
  const glyph = piece.attributes.smufl
  if (piece.name !== 'other-dynamics' || glyph === undefined || piece.rawText.trim() !== '') {
    return undefined
  }
  return GLYPH_LETTERS.get(glyph)
}

/**
 * The letters of the longest run of two or more pieces from `start` that
 * spells a mark, and how many pieces it takes. A space between two pieces
 * keeps them apart. A piece naming a glyph joins only pieces drawn as glyphs
 * alone.
 */
function splitMark(
  pieces: readonly XmlElement[],
  start: number,
): { letters: string; count: number } | undefined {
  const letters: string[] = []
  const drawnAsGlyphs = pieces[start] !== undefined && glyphLetters(pieces[start]) !== undefined
  for (const piece of pieces.slice(start)) {
    const drawn = glyphLetters(piece)
    if (drawnAsGlyphs) {
      if (drawn === undefined) break
      letters.push(drawn)
    } else if (piece.name !== 'other-dynamics') letters.push(piece.name)
    else if (piece.attributes.smufl === undefined) letters.push(piece.rawText)
    else break
  }
  for (let count = letters.length; count > 1; count -= 1) {
    const joined = letters.slice(0, count).join('').trim()
    if (PLAIN_MARK.test(joined) || ACCENT_MARK.test(joined)) return { letters: joined, count }
  }
  return undefined
}

/**
 * The mark elements of the source's direction dynamics, and every
 * <other-dynamics> wording, trimmed as the reader trims it, in document
 * order. A whitespace-only wording draws nothing and is left out. A run of
 * pieces that spells a mark is given as one wording, the letters of that
 * mark, for a converted mark to claim.
 */
function sourceDynamics(root: XmlElement): { marks: string[]; wordings: string[] } {
  const marks: string[] = []
  const wordings: string[] = []
  // A piece drawn as a glyph alone draws the letters of its glyph.
  const addWording = (piece: XmlElement): void => {
    const wording = glyphLetters(piece) ?? piece.rawText.trim()
    if (wording !== '') wordings.push(wording)
  }
  const walk = (element: XmlElement, parent: string): void => {
    if (element.name === 'dynamics' && parent === 'direction-type') {
      let joinedTo = 0
      for (const [index, piece] of element.children.entries()) {
        if (index < joinedTo) continue
        const split = splitMark(element.children, index)
        if (split !== undefined) {
          wordings.push(split.letters)
          joinedTo = index + split.count
        } else if (piece.name === 'other-dynamics') addWording(piece)
        else if (MARK_ELEMENTS.has(piece.name)) marks.push(piece.name)
      }
      return
    }
    if (element.name === 'other-dynamics') addWording(element)
    for (const child of element.children) walk(child, element.name)
  }
  walk(root, '')
  return { marks, wordings }
}

// Where the parts can open a measure in a time signature other than the
// score's, the output does not say which one the part opened with.
const TIME_PARTS_WAYS: ReadonlySet<string> = new Set([
  'unrepresentable:cross-part-time',
  'unrepresentable:per-staff-time',
  'unrepresentable:mid-measure-time',
  'unrepresentable:senza-misura',
])

/**
 * Where the time signature the reader works out ahead of a part, to open each
 * measure with, is not the one in force in the output. The read-ahead walks
 * each measure with a cursor of its own, apart from the measure builder's, to
 * tell a time signature at the measure start from one partway through.
 */
function readAheadTimeDisagreements(
  mnx: MNXDocument,
  root: XmlElement,
  warnings: readonly ConversionWarning[],
): string[] {
  if (warnings.some((warning) => TIME_PARTS_WAYS.has(warning.code))) return []
  let time: MNXTime | undefined
  const inForce = mnx.global.measures.map((measure) => (time = measure.time ?? time))
  return root.children
    .filter((part) => part.name === 'part')
    .flatMap((part) =>
      timesInForce(part).flatMap((opens, index) => {
        const output = inForce[index]
        if (opens === undefined) return []
        if (output?.count === opens.count && output.unit === opens.unit) return []
        const stated = output ? `${String(output.count)}/${String(output.unit)}` : 'none'
        return [
          `${part.attributes['id'] ?? ''} measure ${String(index + 1)}: ` +
            `${String(opens.count)}/${String(opens.unit)}, output ${stated}`,
        ]
      }),
    )
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
    expect(danglingReferences(mnx).slice(0, 5)).toEqual([])
  })

  test('names only staves its parts have', () => {
    expect(staffNumbersPastParts(mnx).slice(0, 5)).toEqual([])
  })

  // MNX states that a jump to a segno, a coda or a Fine implies the document
  // holds exactly one of it. The schema does not check this.
  test('holds one of each object a jump goes to', () => {
    expect(jumpsWithoutOneDestination(mnx)).toEqual([])
  })

  test('orders exactly the verse lines it sings', () => {
    expect(unorderedLyricLines(mnx)).toEqual([])
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
          if (dynamic.type !== 'gradual') continue
          const endsIn = named.get(dynamic.end.measure)
          converted.push(
            `part ${String(partIndex + 1)} ${dynamic.wedgeType}` +
              `${dynamic.value !== undefined ? ` from ${dynamic.value}` : ''} ` +
              `m${String(index + 1)} -> ${endsIn === undefined ? 'a measure the score does not name' : `m${String(endsIn + 1)}`}`,
          )
        }
      })
    })

    expect(converted).toEqual(sourceHairpins(parseXmlRoot(source)))
  })

  // The wording around a dynamic becomes that mark's prefix or suffix, and
  // text spelling a mark becomes the mark, as do pieces of one <dynamics>
  // that spell a mark together. Each other mark element converts. Each
  // wording in the source must be a mark the elements do not account for, or
  // be in the output's wording or in a warning. A substring match for the
  // wording, because several wordings before one mark are joined into one
  // prefix.
  test('carries or reports every dynamic mark and wording the source writes', () => {
    const carried: string[] = []
    const marks = new Map<string, number>()
    for (const part of mnx.parts) {
      for (const measure of part.measures) {
        for (const dynamic of measure.dynamics ?? []) {
          if (dynamic.prefix !== undefined) carried.push(dynamic.prefix)
          if (dynamic.suffix !== undefined) carried.push(dynamic.suffix)
          // A relative dynamic draws its level, as in the "f" of "più f".
          const spelling =
            dynamic.type === 'immediate' || dynamic.type === 'relative'
              ? dynamic.value
              : dynamic.type === 'accent'
                ? (dynamic.accentPrefix ?? 's') +
                  dynamic.value +
                  (dynamic.accentSuffix ?? 'z') +
                  (dynamic.residualValue ?? '')
                : undefined
          if (spelling !== undefined) marks.set(spelling, (marks.get(spelling) ?? 0) + 1)
        }
      }
    }
    const written = sourceDynamics(parseXmlRoot(source))
    for (const name of written.marks) marks.set(name, (marks.get(name) ?? 0) - 1)
    // Only the quoted wording in a warning counts, not the whole message.
    const reported = warnings.flatMap((warning) =>
      [...warning.message.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? ''),
    )

    const lost = written.wordings.filter((wording) => {
      const unclaimed = marks.get(wording) ?? 0
      if (unclaimed > 0) {
        marks.set(wording, unclaimed - 1)
        return false
      }
      return ![...carried, ...reported].some((text) => text.includes(wording))
    })

    expect(lost).toEqual([])
    expect([...marks].filter(([, count]) => count !== 0)).toEqual([])
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
    expect(pitchesOf(mnx)).toEqual(sourcePitches(parseXmlRoot(source), flipLetters(mnx)))
  })

  // MNX advances the sequence cursor by a tuplet's outer, and its content must
  // come to inner. The schema checks the shape of a ratio, not the
  // arithmetic.
  test('draws each part in the key its source states', () => {
    expect(drawnKeyDisagreements(mnx, parseXmlRoot(source), warnings).slice(0, 5)).toEqual([])
  })

  test('opens each measure in the time signature the read-ahead found', () => {
    expect(readAheadTimeDisagreements(mnx, parseXmlRoot(source), warnings).slice(0, 5)).toEqual([])
  })

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
    // measure lengths above. Ten files are skipped here, and no other check
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
