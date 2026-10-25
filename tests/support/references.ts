// MNX names what a beam, tie, slur or span joins by id. The schema checks the
// shape of an id, not whether it leads anywhere, so every conversion output in
// a test is checked here too. A jump names where it goes by its type alone.

import type {
  MNXDocument,
  MNXEvent,
  MNXPartMeasure,
  MNXSequenceItem,
  MNXSystemLayoutContent,
} from '../../src/index.js'

/**
 * The schema properties danglingReferences follows, as definition.property.
 * tests/schema-conformance.test.ts holds this to every id reference the MNX
 * types model.
 */
export const FOLLOWED_REFERENCES = [
  'arpeggio.span',
  'beam.events',
  'event-lyric-line-extender.target',
  'kit-component.sound',
  'kit-note.kitComponent',
  'lyrics-global.lineOrder',
  'measure-rhythmic-position.measure',
  'multimeasure-rest.start',
  'non-arpeggio.span',
  'score.layout',
  'slur.target',
  'staff-source.part',
  'system.measure',
  'tie.target',
] as const

/**
 * Where danglingReferences reads each definition it follows, as the schema
 * properties that hold one. tests/schema-conformance.test.ts holds this to
 * every such property the MNX types model, so a reference written somewhere
 * new is not missed.
 */
export const READ_AT: Readonly<Record<string, readonly string[]>> = {
  arpeggio: ['part-measure.arpeggios'],
  beam: ['beam.beams', 'part-measure.beams'],
  'event-lyric-line-extender': ['event-lyric-line.extender'],
  'kit-component': ['part.kit'],
  'kit-note': ['event.kitNotes'],
  'lyrics-global': ['global.lyrics'],
  'measure-rhythmic-position': ['dynamic-group-gradual.end', 'ottava.end'],
  'multimeasure-rest': ['score.multimeasureRests'],
  'non-arpeggio': ['part-measure.nonArpeggios'],
  score: ['root.scores'],
  slur: ['event.slurs'],
  'staff-source': ['staff.sources'],
  system: ['page.systems'],
  tie: ['kit-note.ties', 'note.ties'],
}

/** The events of a sequence, including those inside tuplets, graces and tremolos. */
function eventsOf(items: readonly MNXSequenceItem[]): MNXEvent[] {
  return items.flatMap((item) => {
    if ('content' in item) return eventsOf(item.content)
    return item.type === 'space' ? [] : [item]
  })
}

function measureEvents(measure: MNXPartMeasure): MNXEvent[] {
  return measure.sequences.flatMap((sequence) => eventsOf(sequence.content))
}

function idsOf(items: readonly { id?: string }[]): Set<string> {
  return new Set(items.flatMap((item) => item.id ?? []))
}

/**
 * Every reference in the document that names nothing it may name, as a short
 * description. An arpeggio joins what its measure holds, and a tie or slur
 * what its part holds. A beam starts in its measure and may run on over the
 * measures after it.
 */
export function danglingReferences(mnx: MNXDocument): string[] {
  const dangling: string[] = []
  const check = (what: string, id: string | undefined, among: ReadonlySet<string>): void => {
    if (id !== undefined && !among.has(id)) dangling.push(`${what} names "${id}"`)
  }

  const measures = idsOf(mnx.global.measures)
  const parts = idsOf(mnx.parts)
  const layouts = idsOf(mnx.layouts ?? [])
  const sounds = new Set(Object.keys(mnx.global.sounds ?? {}))
  const lineOrder = mnx.global.lyrics?.lineOrder
  const lines = new Set(lineOrder)
  // A lyric extender line may end under an event of any part, from the
  // lyric's measure on.
  const anyPartFrom = (measureIndex: number): Set<string> =>
    idsOf(mnx.parts.flatMap((part) => part.measures.slice(measureIndex).flatMap(measureEvents)))

  for (const [partIndex, part] of mnx.parts.entries()) {
    const kit = new Set(Object.keys(part.kit ?? {}))
    const partEvents = part.measures.flatMap(measureEvents)
    const events = idsOf(partEvents)
    const notes = idsOf(partEvents.flatMap((event) => event.notes ?? []))
    const kitNotes = idsOf(partEvents.flatMap((event) => event.kitNotes ?? []))

    for (const [key, component] of Object.entries(part.kit ?? {})) {
      check(`part ${String(partIndex + 1)} kit component ${key} sound`, component.sound, sounds)
    }

    for (const [measureIndex, measure] of part.measures.entries()) {
      const where = `part ${String(partIndex + 1)} measure ${String(measureIndex + 1)}`
      const own = measureEvents(measure)
      const ownEvents = idsOf(own)
      const fromHereOn = idsOf(part.measures.slice(measureIndex).flatMap(measureEvents))
      // An arpeggio over a kit chord runs between kit notes.
      const ownNotes = idsOf(
        own.flatMap((event) => [...(event.notes ?? []), ...(event.kitNotes ?? [])]),
      )

      const beams = [...(measure.beams ?? [])]
      for (const beam of measure.beams ?? [])
        check(`${where} beam start`, beam.events[0], ownEvents)
      for (const beam of beams) {
        for (const id of beam.events) check(`${where} beam`, id, fromHereOn)
        beams.push(...(beam.beams ?? []))
      }
      for (const arpeggio of [...(measure.arpeggios ?? []), ...(measure.nonArpeggios ?? [])]) {
        check(`${where} arpeggio start`, arpeggio.span.start, ownNotes)
        check(`${where} arpeggio end`, arpeggio.span.end, ownNotes)
      }
      for (const dynamic of measure.dynamics ?? []) {
        if (dynamic.type === 'gradual') check(`${where} hairpin end`, dynamic.end.measure, measures)
      }
      for (const ottava of measure.ottavas ?? []) {
        check(`${where} octave shift end`, ottava.end.measure, measures)
      }

      for (const event of own) {
        // A document that orders its verse lines orders every line it sings.
        if (lineOrder !== undefined) {
          for (const line of Object.keys(event.lyrics?.lines ?? {})) {
            check(`${where} lyric line`, line, lines)
          }
        }
        for (const line of Object.values(event.lyrics?.lines ?? {})) {
          const target = line.extender?.target
          if (target !== undefined) {
            check(`${where} lyric extender`, target, anyPartFrom(measureIndex))
          }
        }
        for (const slur of event.slurs ?? []) check(`${where} slur`, slur.target, events)
        for (const note of event.notes ?? []) {
          for (const tie of note.ties ?? []) check(`${where} tie`, tie.target, notes)
        }
        for (const note of event.kitNotes ?? []) {
          check(`${where} kit note`, note.kitComponent, kit)
          for (const tie of note.ties ?? []) check(`${where} kit note tie`, tie.target, kitNotes)
        }
      }
    }
  }

  const fromLayout = (content: MNXSystemLayoutContent, where: string): void => {
    for (const item of content) {
      if (item.type === 'group') {
        fromLayout(item.content, where)
        continue
      }
      for (const source of item.sources) check(`${where} staff`, source.part, parts)
    }
  }
  for (const layout of mnx.layouts ?? []) fromLayout(layout.content, `layout ${layout.id ?? ''}`)

  for (const [scoreIndex, score] of (mnx.scores ?? []).entries()) {
    const where = `score ${String(scoreIndex + 1)}`
    check(`${where} layout`, score.layout, layouts)
    for (const rest of score.multimeasureRests ?? []) {
      check(`${where} multi-measure rest`, rest.start, measures)
    }
    for (const page of score.pages ?? []) {
      for (const system of page.systems) check(`${where} system`, system.measure, measures)
    }
  }

  return dangling
}

/**
 * The names of the schema properties that number a staff of a part.
 * tests/schema-conformance.test.ts holds this to every property the schema
 * types as a staff number.
 */
export const STAFF_NUMBERS = ['staff', 'staffEnd'] as const

/**
 * Every staff number in the document past the staves of the part it names,
 * as a short description. A staff number inside a part names one of that
 * part's staves, and a layout's staff source names one of its part's.
 */
export function staffNumbersPastParts(mnx: MNXDocument): string[] {
  const past: string[] = []
  const names: readonly string[] = STAFF_NUMBERS
  const visit = (value: unknown, where: string, staves: number): void => {
    if (typeof value !== 'object' || value === null) return
    for (const [key, inner] of Object.entries(value)) {
      if (names.includes(key) && typeof inner === 'number' && inner > staves) {
        past.push(`${where} names staff ${String(inner)} of ${String(staves)}`)
      }
      visit(inner, where, staves)
    }
  }
  for (const [index, part] of mnx.parts.entries()) {
    visit(part.measures, `part ${String(index + 1)}`, part.staves ?? 1)
  }

  const staves = new Map(mnx.parts.map((part) => [part.id, part.staves ?? 1]))
  const fromLayout = (content: MNXSystemLayoutContent, where: string): void => {
    for (const item of content) {
      if (item.type === 'group') {
        fromLayout(item.content, where)
        continue
      }
      for (const source of item.sources) {
        const count = staves.get(source.part)
        if (source.staff !== undefined && count !== undefined && source.staff > count) {
          past.push(`${where} names staff ${String(source.staff)} of part ${source.part}`)
        }
      }
    }
  }
  for (const layout of mnx.layouts ?? []) fromLayout(layout.content, `layout ${layout.id ?? ''}`)
  return past
}

/**
 * Where the verse lines a document sings and the order it gives them part
 * ways, as short descriptions. A document orders its verse lines wherever
 * there are two or more, and orders only the lines it sings. A sung line
 * the order leaves out is a dangling reference, reported by danglingReferences.
 */
export function unorderedLyricLines(mnx: MNXDocument): string[] {
  const sung = new Set(
    mnx.parts
      .flatMap((part) => part.measures.flatMap(measureEvents))
      .flatMap((event) => Object.keys(event.lyrics?.lines ?? {})),
  )
  const lineOrder = mnx.global.lyrics?.lineOrder
  if (lineOrder === undefined) {
    return sung.size > 1 ? [`${String(sung.size)} verse lines are sung, and none ordered`] : []
  }
  return lineOrder
    .filter((line) => !sung.has(line))
    .map((line) => `the order names line "${line}", which nothing sings`)
}

type JumpType = NonNullable<MNXDocument['global']['measures'][number]['jump']>['type']

/**
 * The objects each type of jump goes to or stops at. MNX states that a
 * document with such a jump holds exactly one of each. The schema does not
 * check this.
 */
const JUMP_DESTINATIONS: Readonly<Record<JumpType, readonly ('segno' | 'coda' | 'fine')[]>> = {
  dc: [],
  dcAlCoda: ['coda'],
  dcAlFine: ['fine'],
  dsAlCoda: ['segno', 'coda'],
  dsAlFine: ['segno', 'fine'],
  segno: ['segno'],
  toCoda: ['coda'],
}

/**
 * Every jump in a document that does not hold exactly one of each object
 * the jump goes to or stops at, as a short description.
 */
export function jumpsWithoutOneDestination(mnx: MNXDocument): string[] {
  const { measures } = mnx.global
  const found: string[] = []
  for (const [index, { jump }] of measures.entries()) {
    for (const kind of jump ? JUMP_DESTINATIONS[jump.type] : []) {
      const count = measures.filter((measure) => measure[kind] !== undefined).length
      if (count === 1) continue
      found.push(
        `the ${jump?.type ?? ''} jump in measure ${String(index + 1)} goes to a ${kind}, ` +
          `and the document holds ${String(count)}`,
      )
    }
  }
  return found
}
