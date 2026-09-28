// The source-independent structural checks. Each reads the music once from
// the converter's MNX output and once from the MusicXML source, so the two
// can be compared. Nothing here uses the converter's own reader.
//
// One reading is shared, and is marked where it is: how a voice that sounds
// two sequences at once divides into them. MusicXML states the two in one
// <voice>, so both sides divide them the same way. Every pitch, its order in
// its sequence, and the note each syllable is sung on are still checked. The
// division itself is not.
//
// Used by the vendored corpus test and the full-corpus gate.

import type {
  ConversionWarning,
  MNXDocument,
  MNXLayoutStaff,
  MNXLyrics,
  MNXNoteValue,
  MNXSequence,
  MNXSequenceItem,
  MNXStaffGroup,
} from '../../src/index.js'
import type { XmlElement } from '../../src/xml/parse.js'

// How long a written note value lasts, as a fraction of a whole note.
// Independent of the converter's own arithmetic.
const BASE_LENGTHS: Record<string, number> = {
  maxima: 8,
  longa: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  '16th': 1 / 16,
  '32nd': 1 / 32,
  '64th': 1 / 64,
  '128th': 1 / 128,
  '256th': 1 / 256,
  '512th': 1 / 512,
  '1024th': 1 / 1024,
}

export function writtenLength(value: MNXNoteValue): number {
  const base = BASE_LENGTHS[value.base]
  if (base === undefined) throw new Error(`Unknown note value base: ${value.base}`)
  return base * (2 - 2 ** -(value.dots ?? 0))
}

/** The time an item takes, which can differ from its written value. */
export function sounding(item: MNXSequenceItem): number {
  if ('type' in item && item.type === 'space') return item.duration[0] / item.duration[1]
  // A grace note is squeezed in and takes no time.
  if ('type' in item && item.type === 'grace') return 0
  // A two-note tremolo takes its outer duration. Each note is written with
  // the value of the pair.
  if ('type' in item && item.type === 'tremolo') {
    return writtenLength(item.outer.duration) * item.outer.multiple
  }
  // A tuplet takes its outer, whatever it holds: MNX advances the sequence
  // cursor by outer and requires the content to fill inner. Scaling the
  // content by the ratio would repeat the converter's own arithmetic, so a
  // tuplet whose content disagrees with its ratio would never show.
  if ('type' in item && item.type === 'tuplet') {
    return writtenLength(item.outer.duration) * item.outer.multiple
  }
  return writtenLength((item as { duration: MNXNoteValue }).duration)
}

/**
 * Where each event of a sequence begins, as a fraction of a whole note from
 * the start of the measure. Walks into tuplets and grace groups. `scale`
 * carries the tuplet's ratio down to the events inside it.
 */
export function collectStarts(
  items: readonly MNXSequenceItem[],
  at: number,
  scale: number,
  into: Set<string>,
): number {
  for (const item of items) {
    if ('type' in item && item.type === 'tuplet') {
      const outer = writtenLength(item.outer.duration) * item.outer.multiple
      const inner = writtenLength(item.inner.duration) * item.inner.multiple
      collectStarts(item.content, at, (scale * outer) / inner, into)
      at += outer * scale
      continue
    }
    // The notes of a two-note tremolo begin one outer unit apart, whatever
    // value they are written with.
    if ('type' in item && item.type === 'tremolo') {
      const unit = writtenLength(item.outer.duration) * scale
      item.content.forEach((_, index) => {
        into.add((at + index * unit).toFixed(9))
      })
      at += unit * item.outer.multiple
      continue
    }
    // A grace note takes none of the time of the event it ornaments, so it
    // begins where that event does.
    if ('type' in item && item.type === 'grace') {
      into.add(at.toFixed(9))
      continue
    }
    if ('type' in item && item.type === 'space') {
      at += (item.duration[0] / item.duration[1]) * scale
      continue
    }
    into.add(at.toFixed(9))
    at += writtenLength(item.duration) * scale
  }
  return at
}

interface Pitch {
  step: string
  octave: number
  alter: number
}

function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${String(pitch.octave)}${pitch.alter === 0 ? '' : `(${String(pitch.alter)})`}`
}

/**
 * An alteration as MNX states it. MNX counts whole semitones, so a microtone
 * takes the nearest whole alteration, and a half-way one the smaller.
 */
function statedAlter(alter: number): number {
  if (Number.isInteger(alter)) return alter
  return Math.sign(alter) * Math.ceil(Math.abs(alter) - 0.5) || 0
}

/** How many notes in the source are altered by a fraction of a semitone. */
export function sourceMicrotones(root: XmlElement): number {
  let count = 0
  for (const part of root.children.filter((c) => c.name === 'part')) {
    for (const measure of part.children.filter((c) => c.name === 'measure')) {
      for (const note of measure.children.filter((c) => c.name === 'note')) {
        const alter = note.children
          .find((c) => c.name === 'pitch')
          ?.children.find((c) => c.name === 'alter')
          ?.text.trim()
        if (alter !== undefined && !Number.isInteger(Number(alter))) count += 1
      }
    }
  }
  return count
}

/** One line per part and measure: each line's pitches in order, the lines
 * sorted. The source interleaves a measure's voices through its cursor while
 * MNX states each on its own, so the order of the lines may differ. A lost,
 * changed, or reordered pitch within a line still shows.
 *
 * A line that sounds no pitch is left out. The converter drops a redundant
 * rest, such as a rest laid over a rest that fills the measure, and reports
 * it. Counting silent lines would mean repeating each of those rules here. */
function measureLine(part: number, measure: number, voices: readonly string[]): string {
  const sounded = voices.filter((voice) => voice !== '')
  return `part ${String(part + 1)} measure ${String(measure + 1)}: ${sounded.sort().join(' | ')}`
}

/**
 * The rounding margin for line positions. Positions in this file are floats
 * in whole notes, so a line is free where the cursor is within this margin of
 * its end. The smallest value any real score writes is far larger.
 */
const SETTLED = 1e-9

/** One line a voice sounds, and how far through the measure it has run. */
interface SourceLine {
  end: number
  pitches: string[]
}

/** The lines one <voice> sounds, and the one a note joins by default. */
interface VoiceLines {
  lines: SourceLine[]
  active: number
  /**
   * A grace group read into the line the voice last sounded in, waiting for
   * the note it leads into. `at` is its position and `from` is where its
   * pitches begin in that line, so it can move with its note to another line.
   */
  grace: { at: number; from: number } | undefined
}

/** Every pitch in the converted document, one line per part and measure. */
export function pitchesOf(document: MNXDocument): string[] {
  const lines: string[] = []
  document.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      const voices = measure.sequences.map((sequence) => {
        const found: string[] = []
        const walk = (items: readonly MNXSequenceItem[]): void => {
          for (const item of items) {
            if (
              'type' in item &&
              (item.type === 'tuplet' || item.type === 'grace' || item.type === 'tremolo')
            ) {
              walk(item.content)
              continue
            }
            if ('notes' in item && item.notes) {
              for (const note of item.notes) {
                found.push(pitchKey({ ...note.pitch, alter: note.pitch.alter ?? 0 }))
              }
            }
          }
        }
        walk(sequence.content)
        return found.join(' ')
      })
      lines.push(measureLine(partIndex, measureIndex, voices))
    })
  })
  return lines
}

/** The steps in order, and the semitone each of them sits at. */
const STEP_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

/**
 * A part's <transpose>, in MusicXML's direction: the staff steps and half
 * steps from the pitch the player reads to the pitch the instrument sounds.
 * Undefined for a part at concert pitch.
 */
interface SourceTranspose {
  steps: number
  semitones: number
}

/**
 * The first <transpose> an <attributes> states. A part can change instrument
 * partway through a measure, so this is read as the measure is walked.
 */
function statedTranspose(attributes: XmlElement): SourceTranspose | undefined {
  for (const transpose of attributes.children.filter((c) => c.name === 'transpose')) {
    const number = (name: string) => {
      const text = transpose.children.find((c) => c.name === name)?.text.trim() ?? ''
      return text === '' ? 0 : Number(text)
    }
    const octaves = number('octave-change')
    return {
      steps: number('diatonic') + 7 * octaves,
      semitones: number('chromatic') + 12 * octaves,
    }
  }
  return undefined
}

/**
 * The pitch a written note sounds on a transposing instrument. The staff
 * steps set the letter, and the half steps set the alteration, so a written
 * E-flat on a B-flat clarinet sounds a D-flat and not a C-sharp.
 */
function sounded(
  pitch: { step: string; octave: number; alter: number },
  transpose: SourceTranspose | undefined,
): { step: string; octave: number; alter: number } {
  if (!transpose) return pitch
  const index = STEP_ORDER.indexOf(pitch.step)
  const steps = pitch.octave * 7 + index + transpose.steps
  const octave = Math.floor(steps / 7)
  const stepIndex = ((steps % 7) + 7) % 7
  const semitones =
    pitch.octave * 12 + (STEP_SEMITONES[index] ?? 0) + pitch.alter + transpose.semitones

  return {
    step: STEP_ORDER[stepIndex] ?? 'C',
    octave,
    alter: semitones - (octave * 12 + (STEP_SEMITONES[stepIndex] ?? 0)),
  }
}

/**
 * Every pitch in the source, one line per part and measure, read from the
 * XML.
 *
 * A transposing part is written at the pitch its player reads, and MNX states
 * the pitch the instrument sounds, so <transpose> is applied here.
 */
export function sourcePitches(root: XmlElement): string[] {
  const lines: string[] = []
  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      let transpose: SourceTranspose | undefined
      let divisions = 1
      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          // Grouped by voice, and within a voice by the lines it sounds at
          // once. A voice is usually one line, but closed-score hymnals write
          // two lines in one <voice>, laid over each other with <backup>. A
          // note written where its voice is still sounding goes to another
          // line: the one the voice last sounded in if it has room, then the
          // first line with room, then a new line.
          //
          // Order within a line is document order. Some exports (Sibelius)
          // state no <voice> on a chord member, so a chord note without one
          // takes the voice in force. A chord member or a grace note does not
          // choose a line: it joins the note it was written against.
          const byVoice = new Map<string, VoiceLines>()
          let voiceInForce = ''
          let position = 0

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0') /
              (divisions * 4)

            if (item.name === 'attributes') {
              transpose = statedTranspose(item) ?? transpose
              const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
              if (stated) divisions = Number(stated)
              continue
            }
            if (item.name === 'backup') {
              position -= durationOf()
              continue
            }
            if (item.name === 'forward') {
              position += durationOf()
              continue
            }
            if (item.name !== 'note') continue

            const isChord = item.children.some((c) => c.name === 'chord')
            const isGrace = item.children.some((c) => c.name === 'grace')
            const stated = item.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
            const voice = stated === '' && isChord ? voiceInForce : stated
            if (!isChord) voiceInForce = voice

            const held = byVoice.get(voice) ?? { lines: [], active: 0, grace: undefined }
            byVoice.set(voice, held)

            if (!isChord && !isGrace) {
              // A note written before the measure starts is written at the
              // start, as the converter does.
              position = Math.max(0, position)
              const duration = durationOf()
              const free = (line: SourceLine) => line.end <= position + SETTLED
              const last = held.lines[held.active]
              let index = last && free(last) ? held.active : held.lines.findIndex(free)
              if (index === -1) {
                index = held.lines.length
                held.lines.push({ end: 0, pitches: [] })
              }
              // A grace group waiting at this note's position leads into it,
              // so it goes to the note's line.
              const waiting = held.grace
              if (waiting && index !== held.active && Math.abs(waiting.at - position) <= SETTLED) {
                const led = held.lines[held.active]
                if (led)
                  (held.lines[index] as SourceLine).pitches.push(
                    ...led.pitches.splice(waiting.from),
                  )
              }
              held.grace = undefined
              ;(held.lines[index] as SourceLine).end = position + duration
              held.active = index
              position += duration
            } else if (isGrace && !isChord) {
              // A group taking its time from the note before it is drawn
              // after that note and stays in that note's line.
              const stealsPrevious =
                item.children.find((c) => c.name === 'grace')?.attributes['steal-time-previous'] !==
                undefined
              if (stealsPrevious) held.grace = undefined
              else if (!held.grace || Math.abs(held.grace.at - position) > SETTLED) {
                held.grace = { at: position, from: held.lines[held.active]?.pitches.length ?? 0 }
              }
            }

            const line = (held.lines[held.active] ??= { end: 0, pitches: [] })
            const pitch = item.children.find((c) => c.name === 'pitch')
            if (!pitch) continue
            const text = (name: string) =>
              pitch.children.find((c) => c.name === name)?.text.trim() ?? ''
            line.pitches.push(
              pitchKey(
                sounded(
                  {
                    step: text('step'),
                    octave: Number(text('octave')),
                    alter: text('alter') === '' ? 0 : statedAlter(Number(text('alter'))),
                  },
                  transpose,
                ),
              ),
            )
          }

          lines.push(
            measureLine(
              partIndex,
              measureIndex,
              [...byVoice.values()].flatMap((held) =>
                held.lines.map((line) => line.pitches.join(' ')),
              ),
            ),
          )
        })
    })
  return lines
}

/**
 * How long each measure of each part sounds in the source, in whole notes.
 * Follows MusicXML's cursor: notes advance it, chord notes and grace notes do
 * not, and <backup> and <forward> move it. Each duration is converted at the
 * divisions in force, because <divisions> can change in the middle of a
 * measure. Only a note extends the measured length: a <forward> past the last
 * note skips time with nothing written in it.
 *
 * A <backup> can go back past the start of the measure. The cursor follows
 * it, because a <forward> can bring it back, but a note written before the
 * start is written at the start, as the converter does. A chord note joins
 * the event before it and does not stand at the cursor.
 */
export function sourceMeasureLengths(root: XmlElement): number[][] {
  const perPart: number[][] = []

  for (const part of root.children.filter((c) => c.name === 'part')) {
    const lengths: number[] = []
    let divisions = 1

    for (const measure of part.children.filter((c) => c.name === 'measure')) {
      let position = 0
      let furthest = 0

      for (const item of measure.children) {
        const durationOf = () =>
          Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0') /
          (divisions * 4)

        if (item.name === 'attributes') {
          const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
          if (stated) divisions = Number(stated)
        } else if (item.name === 'backup') {
          position -= durationOf()
        } else if (item.name === 'forward') {
          position += durationOf()
        } else if (item.name === 'note') {
          const isChord = item.children.some((c) => c.name === 'chord')
          const isGrace = item.children.some((c) => c.name === 'grace')
          // A chord note joins the event before it, so it does not move a
          // cursor that is before the measure start.
          if (!isChord) position = Math.max(0, position)
          if (!isChord && !isGrace) position += durationOf()
          furthest = Math.max(furthest, position)
        }
      }
      lengths.push(furthest)
    }
    perPart.push(lengths)
  }
  return perPart
}

/**
 * How long a sequence runs in silence inside the tuplet it ends on, at the
 * time that silence takes. A bracket completed by the silence after it
 * states that silence inside itself.
 */
function bracketedSilence(items: readonly MNXSequenceItem[], inTuplet = false): number {
  let silence = 0
  for (const item of [...items].reverse()) {
    if ('type' in item && item.type === 'space' && inTuplet) {
      silence += sounding(item)
      continue
    }
    if (!('type' in item) || item.type !== 'tuplet') break
    const held = item.content.reduce((sum, inner) => sum + sounding(inner), 0)
    const inside = bracketedSilence(item.content, true)
    silence += (inside * sounding(item)) / held
    if (inside < held - 1e-9) break
  }
  return silence
}

/**
 * The voices that warnings with the given code name, keyed by part and
 * measure as "partIndex:measureIndex", both from zero. A warning names its
 * <note> by line, and the voice is that note's: a chord note with no <voice>
 * is in the voice of the note it joins, and any other note with no <voice> is
 * in the unnamed voice, written ''. Where no single voice is at that line,
 * the warning names every voice of the measure, written undefined.
 */
function voicesWarned(
  root: XmlElement,
  warnings: readonly ConversionWarning[],
  code: ConversionWarning['code'],
): Map<string, Set<string | undefined>> {
  const parts = root.children.filter((c) => c.name === 'part')
  const indexOfPart = new Map(parts.map((part, index) => [part.attributes['id'], index]))
  const named = new Map<string, Set<string | undefined>>()

  for (const warning of warnings) {
    if (warning.code !== code) continue
    const partIndex = indexOfPart.get(warning.context.part)
    const measureIndex = (warning.context.measure ?? 0) - 1
    if (partIndex === undefined || measureIndex < 0) continue
    const measure = parts[partIndex]?.children.filter((c) => c.name === 'measure')[measureIndex]

    let inForce = ''
    const atLine = new Set<string>()
    for (const note of measure?.children.filter((c) => c.name === 'note') ?? []) {
      const stated = note.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
      const isChord = note.children.some((c) => c.name === 'chord')
      const own = stated === '' && isChord ? inForce : stated
      if (!isChord) inForce = own
      if (note.line === warning.context.line) atLine.add(own)
    }

    const key = `${String(partIndex)}:${String(measureIndex)}`
    const voices = named.get(key) ?? new Set()
    voices.add(atLine.size === 1 ? [...atLine][0] : undefined)
    named.set(key, voices)
  }
  return named
}

/** The voice the source names for a sequence: a line laid over voice "1" is "1.2". */
function sourceVoiceOf(sequence: MNXSequence): string {
  return (sequence.voice ?? '').split('.')[0] ?? ''
}

/**
 * Every measure whose converted length disagrees with the source's, part by
 * part. A measure is as long as its longest sequence.
 *
 * Two converter rules change a measure's length. First, a bracket that closes
 * short of its ratio takes in the silence after it up to the barline, which
 * in a part written shorter than the others is past where the part runs. So a
 * measure may run past the source, but only in that silence, and only to the
 * barline: the time signature, or where the part runs further. A pickup's
 * barline is where its longest part ends. Second, a bracket whose ratio no
 * pair of note values states either takes a time the source does not give its
 * notes, with an unrepresentable:tuplet-ratio warning, or is dropped so its
 * notes take their written time. The voice that warning names is skipped in
 * its measure, and every other voice may run no further than the source.
 */
export function measureLengthDisagreements(
  document: MNXDocument,
  root: XmlElement,
  warnings: readonly ConversionWarning[],
): string[] {
  const lengths = sourceMeasureLengths(root)
  const reported = voicesWarned(root, warnings, 'unrepresentable:tuplet-ratio')
  const found: string[] = []
  let time: { count: number; unit: number } | undefined

  const firstPart = root.children.find((c) => c.name === 'part')
  const sourceMeasures = firstPart?.children.filter((c) => c.name === 'measure') ?? []

  document.global.measures.forEach((global, measureIndex) => {
    time = global.time ?? time
    // A pickup ends where its music does: the time signature counts from the
    // barline after it. Every part writes the pickup, so the first part is
    // enough.
    const pickup = sourceMeasures[measureIndex]?.attributes['implicit'] === 'yes'
    const signature = pickup
      ? Math.max(...lengths.map((part) => part[measureIndex] ?? 0))
      : time
        ? time.count / time.unit
        : 0

    document.parts.forEach((part, partIndex) => {
      const measure = part.measures[measureIndex]
      // A full-measure rest states no length of its own. The time signature
      // does.
      if (!measure || measure.sequences.some((sequence) => sequence.fullMeasure)) return

      const inSource = lengths[partIndex]?.[measureIndex] ?? 0
      const barline = Math.max(signature, inSource)
      const at = `part ${String(partIndex + 1)} measure ${String(measureIndex + 1)}`
      const totals = measure.sequences.map((sequence) =>
        sequence.content.reduce((sum, item) => sum + sounding(item), 0),
      )
      // Past the source only in the silence a bracket ends on, and only to the
      // barline.
      const overruns = (sequence: MNXSequence, total: number) =>
        total > inSource + 1e-9 &&
        (total - bracketedSilence(sequence.content) > inSource + 1e-9 || total > barline + 1e-9)

      const passedOver = reported.get(`${String(partIndex)}:${String(measureIndex)}`)
      if (passedOver) {
        measure.sequences.forEach((sequence, index) => {
          if (passedOver.has(undefined) || passedOver.has(sourceVoiceOf(sequence))) return
          const total = totals[index] ?? 0
          if (overruns(sequence, total)) {
            found.push(
              `${at}: voice ${String(index + 1)} runs ${String(total)} ` +
                `against ${String(inSource)} in the source`,
            )
          }
        })
        return
      }

      const converted = Math.max(0, ...totals)
      if (Math.abs(converted - inSource) <= 1e-9) return
      const silentPast =
        converted > inSource &&
        measure.sequences.every((sequence, index) => !overruns(sequence, totals[index] ?? 0))
      if (silentPast) return

      found.push(`${at}: ${String(converted)} against ${String(inSource)} in the source`)
    })
  })
  return found
}

/**
 * The written length of a sequence's items, in whole notes, which a tuplet
 * around them must count. A nested tuplet or a tremolo counts for the time it
 * takes, as MNX counts it. A grace group counts for none.
 */
function writtenExtent(items: readonly MNXSequenceItem[]): number {
  let total = 0
  for (const item of items) {
    if ('type' in item && item.type === 'grace') continue
    if ('type' in item && item.type === 'space') {
      total += item.duration[0] / item.duration[1]
      continue
    }
    if ('type' in item && (item.type === 'tuplet' || item.type === 'tremolo')) {
      total += writtenLength(item.outer.duration) * item.outer.multiple
      continue
    }
    total += writtenLength(item.duration)
  }
  return total
}

/**
 * Whether any tuplet in these items holds something other than what its inner
 * counts. MNX advances the sequence cursor by a tuplet's outer, and its
 * content must come to inner. The schema checks the shape of a ratio, not the
 * arithmetic.
 *
 * Only a tuplet holds another. A tremolo and a grace group hold events.
 */
export function holdsUnderfilledTuplet(items: readonly MNXSequenceItem[]): boolean {
  for (const item of items) {
    if ('type' in item && item.type === 'tuplet') {
      const inner = writtenLength(item.inner.duration) * item.inner.multiple
      if (Math.abs(writtenExtent(item.content) - inner) > 1e-9) return true
      if (holdsUnderfilledTuplet(item.content)) return true
    }
  }
  return false
}

/** The measures holding such a tuplet, keyed as the length checks index. */
export function underfilledTuplets(document: MNXDocument): Set<string> {
  const found = new Set<string>()

  document.parts.forEach((part, partIndex) => {
    part.measures?.forEach((measure, measureIndex) => {
      for (const sequence of measure.sequences ?? []) {
        if (holdsUnderfilledTuplet(sequence.content)) {
          found.add(`${String(partIndex)}:${String(measureIndex)}`)
        }
      }
    })
  })
  return found
}

/** An event of the converted document, and where in the score it stands. */
interface PlacedEvent {
  item: { id?: string; slurs?: { target: string }[]; lyrics?: MNXLyrics }
  place: string
}

/**
 * Every event of the converted document with the place it begins. Walks each
 * voice's sequence, because a slur can run between voices.
 */
function placedEvents(document: MNXDocument): PlacedEvent[] {
  const placed: PlacedEvent[] = []

  document.parts.forEach((part, partIndex) => {
    part.measures?.forEach((measure, measureIndex) => {
      for (const sequence of measure.sequences ?? []) {
        placeEvents(sequence.content, 0, 1, (item, at) => {
          placed.push({ item, place: place(partIndex, measureIndex, at) })
        })
      }
    })
  })
  return placed
}

function place(part: number, measure: number, at: number): string {
  // Cursor arithmetic on one side can go back to the measure start and end
  // just below zero, which prints with a minus sign. Rounding makes the two
  // sides agree.
  const rounded = Math.round(at * 1e9) / 1e9
  const from = rounded === 0 ? 0 : rounded
  return `part ${String(part + 1)} measure ${String(measure + 1)} at ${from.toFixed(9)}`
}

/** The same walk as collectStarts, handing back each event and where it is. */
function placeEvents(
  items: readonly MNXSequenceItem[],
  at: number,
  scale: number,
  found: (item: PlacedEvent['item'], at: number) => void,
): number {
  for (const item of items) {
    if ('type' in item && item.type === 'tuplet') {
      const outer = writtenLength(item.outer.duration) * item.outer.multiple
      const inner = writtenLength(item.inner.duration) * item.inner.multiple
      placeEvents(item.content, at, (scale * outer) / inner, found)
      at += outer * scale
      continue
    }
    // The notes of a two-note tremolo begin one outer unit apart.
    if ('type' in item && item.type === 'tremolo') {
      const unit = writtenLength(item.outer.duration) * scale
      item.content.forEach((inner, index) => {
        found(inner, at + index * unit)
      })
      at += unit * item.outer.multiple
      continue
    }
    // Grace notes take none of the time of the event they ornament, so every
    // note of a group begins where that event does.
    if ('type' in item && item.type === 'grace') {
      for (const inner of item.content) found(inner, at)
      continue
    }
    if ('type' in item && item.type === 'space') {
      at += (item.duration[0] / item.duration[1]) * scale
      continue
    }
    found(item, at)
    at += writtenLength(item.duration) * scale
  }
  return at
}

/**
 * The written length of a <note>, in whole notes: its <type> with its dots,
 * scaled by any <time-modification>. Undefined where the note states no
 * <type>.
 *
 * A source can write a <duration> that differs from the written value. The
 * converter keeps the written value and reports the difference, so a place
 * read from the source must use the written value too.
 */
function drawnLength(note: XmlElement): number | undefined {
  const type = note.children.find((c) => c.name === 'type')?.text.trim()
  const base = type === undefined ? undefined : BASE_LENGTHS[type]
  if (base === undefined) return undefined

  const dots = note.children.filter((c) => c.name === 'dot').length
  const modification = note.children.find((c) => c.name === 'time-modification')
  const stated = (name: string): number => {
    const text = modification?.children.find((c) => c.name === name)?.text.trim()
    return text === undefined || text === '' ? 1 : Number(text)
  }
  const actual = stated('actual-notes')
  return (base * (2 - 2 ** -dots) * stated('normal-notes')) / (actual === 0 ? 1 : actual)
}

/**
 * Every lyric syllable in the source, as the place it is sung, the verse
 * line it belongs to and its text. Follows the cursor as sourceSlurSpans and
 * sourceMeasureLengths do.
 */
export function sourceLyricPlaces(root: XmlElement): string[] {
  const found: string[] = []

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0') /
              (divisions * 4)

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
              if (stated) divisions = Number(stated)
              continue
            }
            if (item.name === 'backup') {
              position -= durationOf()
              continue
            }
            if (item.name === 'forward') {
              position += durationOf()
              continue
            }
            if (item.name !== 'note') continue

            const isChord = item.children.some((c) => c.name === 'chord')
            const isGrace = item.children.some((c) => c.name === 'grace')

            // One text per line per note, because MNX states one lyric per
            // line on an event. A source can write the same <lyric
            // number="1"> twice on one note. differingLyricLines reports it
            // where the two texts differ.
            const perLine = new Map<string, string>()
            for (const lyric of item.children.filter((c) => c.name === 'lyric')) {
              // Every <text>, joined by what the source put between them.
              // Two syllables sung on one note are written as two <text>s.
              // Trimmed at the ends, with any line break inside dropped, as
              // the reader joins them: whitespace around a syllable and a
              // line break from a pretty-printer are layout. A no-break space
              // is not layout and stays.
              //
              // The pattern is a copy of the reader's, not an import, so the
              // corpus run fails when one changes without the other.
              const text = lyric.children
                .filter((c) => c.name === 'text' || c.name === 'elision')
                .map((c) => c.text)
                .join('')
                .replace(/[ \t\r\n]*[\r\n][ \t\r\n]*/g, '')
                .trim()
              if (text === '') continue
              perLine.set(String(lyric.attributes.number ?? '1'), text)
            }
            for (const [line, text] of perLine) {
              found.push(`${place(partIndex, measureIndex, position)} line ${line}: ${text}`)
            }

            if (!isChord && !isGrace) position += drawnLength(item) ?? durationOf()
          }
        })
    })
  return found
}

/**
 * Every lyric syllable in the converted document, as the place it is sung,
 * the verse line it belongs to and its text.
 *
 * Placed, not grouped by sequence: a voice written as two lines laid over
 * each other is two sequences in MNX and one voice in the source. Both sides
 * can read the place without agreeing on how the lines divide, and a
 * syllable moved to another note shows.
 */
export function lyricPlaces(document: MNXDocument): string[] {
  const found: string[] = []
  for (const { item, place: at } of placedEvents(document)) {
    for (const [line, verse] of Object.entries(item.lyrics?.lines ?? {})) {
      found.push(`${at} line ${line}: ${verse.text}`)
    }
  }
  return found
}

/**
 * Every slur in the converted document, as the two places it joins. The
 * event a slur starts on has no id unless something points at it, so each
 * end is named by its place, not by id.
 */
export function slurSpans(document: MNXDocument): Set<string> {
  const placed = placedEvents(document)
  const byId = new Map<string, string>()
  for (const { item, place: at } of placed) {
    if (item.id !== undefined) byId.set(item.id, at)
  }

  const spans = new Set<string>()
  for (const { item, place: from } of placed) {
    for (const slur of item.slurs ?? []) {
      const to = byId.get(slur.target)
      if (to !== undefined) spans.add(`${from} -> ${to}`)
    }
  }
  return spans
}

interface SourceSlurEnd {
  kind: string
  at: string
  measure: number
  voice: string
  number: string
}

/**
 * Whether a voice's ends of one slur number, within one measure, leave an
 * end over: an unclosed start, an orphan stop, or one of each.
 */
function measureResidue(ends: readonly SourceSlurEnd[]): 'unclosed' | 'orphan' | 'both' | 'none' {
  let open = 0
  let orphaned = false
  for (const end of ends) {
    if (end.kind === 'start') {
      open += 1
      continue
    }
    if (open === 0) orphaned = true
    else open -= 1
  }
  if (orphaned && open > 0) return 'both'
  if (orphaned) return 'orphan'
  if (open > 0) return 'unclosed'
  return 'none'
}

/** The pairs a voice's own, balanced ends of one number join, read alone. */
function ownPairs(ends: readonly SourceSlurEnd[]): { start: SourceSlurEnd; stop: SourceSlurEnd }[] {
  const pairs: { start: SourceSlurEnd; stop: SourceSlurEnd }[] = []
  let open: SourceSlurEnd | undefined
  for (const end of ends) {
    if (end.kind === 'start') {
      open = end
      continue
    }
    if (open) pairs.push({ start: open, stop: end })
    open = undefined
  }
  return pairs
}

/**
 * The voice-and-number streams to leave out even though they balance and
 * never nest. Two cross-voice slurs that reuse this voice's number can leave
 * it with one start and one stop of its own, which reading alone cannot tell
 * apart from a slur it states. A stream is left out when other voices hold
 * both of these for the same number:
 *
 *   - an orphan stop at the measure of this pair's start or the one after
 *   - an unclosed start at the measure of this pair's stop or the one before
 *
 * Both sides are required, because a voice's own slur often runs past an
 * unrelated stray end in another voice.
 */
function crossesVoicesInAMeasure(ends: readonly SourceSlurEnd[]): ReadonlySet<string> {
  const byNumber = new Map<string, SourceSlurEnd[]>()
  for (const end of ends) {
    byNumber.set(end.number, [...(byNumber.get(end.number) ?? []), end])
  }

  const crossing = new Set<string>()
  for (const [number, numberEnds] of byNumber) {
    const byVoice = new Map<string, SourceSlurEnd[]>()
    for (const end of numberEnds) {
      byVoice.set(end.voice, [...(byVoice.get(end.voice) ?? []), end])
    }

    const residueAt = new Map<string, Map<number, 'unclosed' | 'orphan' | 'both'>>()
    for (const [voice, voiceEnds] of byVoice) {
      const byMeasure = new Map<number, SourceSlurEnd[]>()
      for (const end of voiceEnds) {
        byMeasure.set(end.measure, [...(byMeasure.get(end.measure) ?? []), end])
      }
      const perMeasure = new Map<number, 'unclosed' | 'orphan' | 'both'>()
      for (const [measure, atMeasure] of byMeasure) {
        const residue = measureResidue(atMeasure)
        if (residue !== 'none') perMeasure.set(measure, residue)
      }
      residueAt.set(voice, perMeasure)
    }

    const nearbyResidue = (
      exceptVoice: string,
      measures: readonly number[],
      kinds: readonly ('unclosed' | 'orphan' | 'both')[],
    ): boolean =>
      [...residueAt.entries()].some(
        ([voice, perMeasure]) =>
          voice !== exceptVoice &&
          measures.some((measure) => {
            const found = perMeasure.get(measure)
            return found !== undefined && kinds.includes(found)
          }),
      )

    for (const [voice, voiceEnds] of byVoice) {
      const own = ownPairs(voiceEnds)
      // Read alone, a voice's ends account for each other only where the
      // pairing is unambiguous: see the doc comment on sourceSlurSpans.
      if (own.length * 2 !== voiceEnds.length) continue
      for (const pair of own) {
        const confirmedAtStart = nearbyResidue(
          voice,
          [pair.start.measure, pair.start.measure + 1],
          ['orphan', 'both'],
        )
        const confirmedAtStop = nearbyResidue(
          voice,
          [pair.stop.measure, pair.stop.measure - 1],
          ['unclosed', 'both'],
        )
        if (confirmedAtStart && confirmedAtStop) crossing.add(`${voice}|${number}`)
      }
    }
  }
  return crossing
}

/**
 * The slurs the source states without doubt, as the two places each joins.
 *
 * MusicXML writes a measure one voice at a time, so within a voice the
 * document order is usually the time order. A slur in one voice can be
 * paired by reading alone only where its ends of that number balance and it
 * never holds two open at once. A voice whose ends do not balance has slurs
 * that run to another voice, and one that nests them is ambiguous. Both are
 * left out.
 *
 * A measure where a voice sounds two lines at once is left out too. There
 * the second line is written after the first and sounds with it, so a start
 * and a stop written in sequence may be in different lines.
 *
 * A slur on a chord member is left out, because the converter reports it as
 * a loss.
 */
export function sourceSlurSpans(root: XmlElement): Set<string> {
  const spans = new Set<string>()

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      // Every slur end of the part, per voice and slur number, in document
      // order.
      const streams = new Map<string, SourceSlurEnd[]>()
      // The voice-and-measure pairs where a voice sounds two lines at once,
      // whose slurs cannot be paired by reading alone.
      const laidOver = new Set<string>()
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0
          let voiceInForce = ''
          // How far each voice has sounded in this measure. A voice that
          // writes a note before its own end sounds two lines at once.
          const reached = new Map<string, number>()

          for (const item of measure.children) {
            const durationOf = () =>
              Number(item.children.find((c) => c.name === 'duration')?.text.trim() ?? '0') /
              (divisions * 4)

            if (item.name === 'attributes') {
              const stated = item.children.find((c) => c.name === 'divisions')?.text.trim()
              if (stated) divisions = Number(stated)
              continue
            }
            if (item.name === 'backup') {
              position -= durationOf()
              continue
            }
            if (item.name === 'forward') {
              position += durationOf()
              continue
            }
            if (item.name !== 'note') continue

            const isChord = item.children.some((c) => c.name === 'chord')
            const isGrace = item.children.some((c) => c.name === 'grace')
            const stated = item.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
            const voice = stated === '' && isChord ? voiceInForce : stated
            if (!isChord) voiceInForce = voice

            if (!isChord && !isGrace) {
              const end = reached.get(voice)
              if (end !== undefined && position < end - SETTLED)
                laidOver.add(`${voice}|${String(measureIndex)}`)
              reached.set(voice, Math.max(end ?? 0, position + durationOf()))
            }

            if (!isChord) {
              const here = place(partIndex, measureIndex, position)
              for (const notations of item.children.filter((c) => c.name === 'notations')) {
                for (const slur of notations.children.filter((c) => c.name === 'slur')) {
                  const kind = slur.attributes.type ?? ''
                  if (kind !== 'start' && kind !== 'stop') continue
                  const number = slur.attributes.number ?? '1'
                  const key = `${voice}|${number}`
                  streams.set(key, [
                    ...(streams.get(key) ?? []),
                    { kind, at: here, measure: measureIndex, voice, number },
                  ])
                }
              }
            }
            if (!isChord && !isGrace) position += durationOf()
          }
        })

      // A stream can balance by coincidence (see crossesVoicesInAMeasure).
      // Such a stream is left out, as is one that does not balance.
      const crossing = crossesVoicesInAMeasure([...streams.values()].flat())

      for (const [key, ends] of streams) {
        if (crossing.has(key)) continue
        if (ends.some((end) => laidOver.has(`${end.voice}|${String(end.measure)}`))) continue
        const open: string[] = []
        const paired: string[] = []
        let plain = true
        for (const end of ends) {
          if (end.kind === 'start') {
            open.push(end.at)
            if (open.length > 1) {
              plain = false
              break
            }
            continue
          }
          const from = open.pop()
          if (from === undefined) {
            plain = false
            break
          }
          paired.push(`${from} -> ${end.at}`)
        }
        if (!plain || open.length > 0) continue
        for (const span of paired) spans.add(span)
      }
    })
  return spans
}

/**
 * What a layout hides. A layout can state less than the part list and stay
 * legal MNX: a staff with no label or labelref hides its part's name, and a
 * multi-staff part written as bare sibling staves loses its grand staff.
 * This checks that every drawn part name is reachable from the layout, and
 * that every multi-staff part the layout draws is in exactly one braced
 * group of its own staves.
 */
export function layoutLosses(document: MNXDocument): string[] {
  const layouts = document.layouts ?? []

  // A multi-staff part needs a layout to state its grand staff. Without this,
  // the checks below would pass on a document with no layouts.
  if (layouts.length === 0) {
    return document.parts
      .filter((part) => (part.staves ?? 1) > 1)
      .map((part, index) => `part ${part.id ?? String(index + 1)}: multi-staff with no layout`)
  }

  const staves = new Map<string, number>()
  const namesDrawn = new Set<string>()
  for (const part of document.parts) {
    if (part.id === undefined) continue
    staves.set(part.id, part.staves ?? 1)
    if (part.name !== undefined || part.shortName !== undefined) namesDrawn.add(part.id)
  }

  // A braced group states one part's grand staff when it holds that part's
  // staves, first to last, and nothing else. The barlines must be stated as
  // connected too: the schema declares no default, so a group with no
  // barlineStyle leaves the barlines split.
  const bracesWhole = (group: MNXStaffGroup, part: string): boolean =>
    group.symbol === 'brace' &&
    (group.barlineStyle === 'instrument' || group.barlineStyle === 'unified') &&
    group.content.length === (staves.get(part) ?? 0) &&
    group.content.every(
      (item, index) =>
        item.type === 'staff' &&
        item.sources.length === 1 &&
        item.sources[0]?.part === part &&
        item.sources[0].staff === index + 1,
    )

  const drawn = new Set<string>()
  const named = new Set<string>()
  const braced = new Map<string, number>()

  const walk = (items: readonly (MNXStaffGroup | MNXLayoutStaff)[], labelled: boolean): void => {
    for (const item of items) {
      if (item.type === 'group') {
        const first = item.content[0]
        const part = first?.type === 'staff' ? first.sources[0]?.part : undefined
        if (part !== undefined && bracesWhole(item, part)) {
          braced.set(part, (braced.get(part) ?? 0) + 1)
        }
        walk(item.content, labelled || item.label !== undefined)
        continue
      }
      const labels = item.label !== undefined || item.labelref !== undefined
      for (const source of item.sources) {
        drawn.add(source.part)
        if (labelled || labels || source.label !== undefined || source.labelref !== undefined) {
          named.add(source.part)
        }
      }
    }
  }
  for (const layout of layouts) walk(layout.content, false)

  const losses: string[] = []
  for (const part of [...drawn].sort()) {
    if (namesDrawn.has(part) && !named.has(part)) {
      losses.push(`part ${part}: name unreachable from the layout`)
    }
    const count = staves.get(part) ?? 1
    if (count > 1 && (braced.get(part) ?? 0) !== 1) {
      losses.push(`part ${part}: ${String(count)} staves without one braced group of their own`)
    }
  }
  return losses
}

/**
 * Every place the source states one lyric line twice on one note with
 * different texts. MNX states one lyric per line per event, so only one of
 * the two reaches the output. Two with the same text lose nothing.
 *
 * Compared on the words and the syllabic, which are all MNX states for a
 * verse on an event, so this and the reader call the same pairs a loss.
 */
export function differingLyricLines(root: XmlElement): string[] {
  const found: string[] = []
  for (const part of root.children.filter((c) => c.name === 'part')) {
    for (const measure of part.children.filter((c) => c.name === 'measure')) {
      for (const note of measure.children.filter((c) => c.name === 'note')) {
        const perLine = new Map<string, string>()
        for (const lyric of note.children.filter((c) => c.name === 'lyric')) {
          const line = lyric.attributes.number ?? '1'
          const pieces = lyric.children.filter((c) => c.name === 'text' || c.name === 'elision')
          // A lyric with no <text> states no verse: one with only an <extend>
          // continues a melisma under a later note.
          if (!pieces.some((c) => c.name === 'text')) continue
          // Every piece, joined and trimmed as the reader joins them, so a
          // verse elided across two <text>s is compared whole. A syllabic of
          // "single" and no syllabic both mean a syllable on its own.
          const written = pieces
            .map((c) => c.text)
            .join('')
            .trim()
          // A syllable of only whitespace draws nothing, so the reader states
          // no verse for it.
          if (written === '') continue
          const spelling = lyric.children.find((c) => c.name === 'syllabic')?.text.trim() ?? ''
          const verse = `${written}/${spelling === 'single' ? '' : spelling}`
          const seen = perLine.get(line)
          if (seen !== undefined && seen !== verse) {
            found.push(
              `part ${part.attributes.id ?? ''} measure ${measure.attributes.number ?? ''} ` +
                `line ${line}: "${seen}" against "${verse}"`,
            )
          }
          perLine.set(line, verse)
        }
      }
    }
  }
  return found
}

/**
 * Where a sequence states a rest filling its measure and still holds
 * content, as "part 1 measure 3 voice 1". MNX states such a rest on the
 * sequence and requires its content to be empty. The schema does not check
 * this.
 */
export function crowdedMeasureRests(document: MNXDocument): string[] {
  const found: string[] = []
  for (const [partIndex, part] of document.parts.entries()) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      for (const sequence of measure.sequences) {
        if (!sequence.fullMeasure || sequence.content.length === 0) continue
        found.push(
          `part ${String(partIndex + 1)} measure ${String(measureIndex + 1)} ` +
            `voice ${sequence.voice ?? '(unnamed)'}`,
        )
      }
    }
  }
  return found
}

/**
 * Every key of the document that is present and set to undefined, named by
 * its path. MNX reads an absent key and one set to undefined as different
 * things: an absent bracket leaves the renderer to decide. The writer builds
 * optional keys conditionally. Neither the compiler nor toEqual catches a key
 * set to undefined, and JSON.stringify drops it, so the emitted text is the
 * same and the object a consumer reads is not.
 */
export function undefinedKeys(value: unknown, path = 'mnx'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => undefinedKeys(item, `${path}[${String(index)}]`))
  }
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, held]) =>
    held === undefined ? [`${path}.${key}`] : undefinedKeys(held, `${path}.${key}`),
  )
}
