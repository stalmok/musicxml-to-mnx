// The source-independent structural checks: what the music is, read once from
// the converter's MNX output and once from the MusicXML source, so the two
// can be held against each other. Nothing here goes through the converter's
// own reader, which is the point: it has to be able to disagree with it.
//
// One reading is shared rather than independent, and is marked where it is:
// how a voice that sounds two lines at once divides into them. MusicXML
// states the two in one <voice>, so there is nothing in the source to read
// the division off, and both sides settle it the same way. What that leaves
// checked is every pitch, its line's order, and which note each syllable is
// sung on; what it leaves unchecked is the division itself.
//
// Shared by the vendored corpus test and the full-corpus gate, so both hold
// the output to the same equivalence.

import type {
  MNXDocument,
  MNXLayoutStaff,
  MNXLyrics,
  MNXNoteValue,
  MNXSequenceItem,
  MNXStaffGroup,
} from '../../src/index.js'
import type { XmlElement } from '../../src/xml/parse.js'

// How long a written note value lasts, as a fraction of a whole note. Kept
// separate from the converter's own arithmetic on purpose.
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

/** How much of the measure an item occupies, which is not what it is written as. */
export function sounding(item: MNXSequenceItem): number {
  if ('type' in item && item.type === 'space') return item.duration[0] / item.duration[1]
  // A grace note is squeezed in and takes no time.
  if ('type' in item && item.type === 'grace') return 0
  // A two-note tremolo occupies its outer duration: each note is written
  // with the value of the pair, not with what it occupies.
  if ('type' in item && item.type === 'tremolo') {
    return writtenLength(item.outer.duration) * item.outer.multiple
  }
  if ('type' in item && item.type === 'tuplet') {
    // Scaled by the ratio rather than assumed full, so a tuplet the source
    // only partly fills is still measured correctly.
    const written = item.content.reduce((total, inner) => total + sounding(inner), 0)
    const outer = writtenLength(item.outer.duration) * item.outer.multiple
    const inner = writtenLength(item.inner.duration) * item.inner.multiple
    return (written * outer) / inner
  }
  return writtenLength((item as { duration: MNXNoteValue }).duration)
}

/**
 * Where each event of a sequence begins, as a fraction of a whole note from
 * the start of the measure. Walks into tuplets and grace groups, because an
 * event inside one begins at a place of its own, and `scale` carries the
 * tuplet's ratio down so the events inside it land where they sound.
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
      at = collectStarts(item.content, at, (scale * outer) / inner, into)
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
    // A grace note is squeezed in beside the event it ornaments and takes
    // none of its time, so it begins where that event does.
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

/** One line per part and measure: each line's pitches in order, the lines
 * sorted. The lines sort because the source interleaves a measure's voices
 * through its cursor while MNX states each on its own, so their order is the
 * one thing the two sides may legitimately disagree on. A lost, changed, or
 * reordered pitch within a line still shows.
 *
 * A line that sounds no pitch is left out, so how many of those a measure
 * holds is not compared. Counting them was tried and does not work: the
 * converter drops a rest that adds nothing to silence already written, as a
 * rest laid over a rest that fills the measure, and reports it. The source
 * draws both, so the two sides can only agree on how many silent lines a
 * measure holds if this reproduces every rule the converter drops one by,
 * which is more of the converter's reading than a check should hold. */
function measureLine(part: number, measure: number, voices: readonly string[]): string {
  const sounded = voices.filter((voice) => voice !== '')
  return `part ${String(part + 1)} measure ${String(measure + 1)}: ${sounded.sort().join(' | ')}`
}

/**
 * One line a voice sounds, and how far through the measure it has run. These
 * positions are added up in whole notes rather than in exact fractions, as
 * the rest of this file is, so a line counts as free where the cursor stands
 * within a rounding step of its end. The smallest value any real score writes
 * is far larger than this.
 */
const SETTLED = 1e-9

interface SourceLine {
  end: number
  pitches: string[]
}

/** The lines one <voice> sounds, and the one a note joins by default. */
interface VoiceLines {
  lines: SourceLine[]
  active: number
  /**
   * A grace group read into the line the voice last sounded in, still
   * waiting for the note it leads into. `at` is where it stands and `from`
   * is where its pitches begin in that line, so that it can follow its note
   * into whichever line the note takes.
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
 * What a part's <transpose> says, in MusicXML's own direction: the staff
 * steps and half steps from the pitch the player reads to the pitch the
 * instrument sounds. Undefined for a part at concert pitch.
 */
interface SourceTranspose {
  steps: number
  semitones: number
}

/**
 * The first <transpose> an <attributes> states, where it states one. A part
 * changes instrument by writing one partway through a measure, so this is
 * asked as the measure is walked rather than once for the whole of it.
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
 * The pitch a written note sounds on a transposing instrument. Worked out
 * from the source's own numbers rather than through the converter: the staff
 * steps settle the letter, and the half steps settle the alteration, so a
 * written E-flat on a B-flat clarinet sounds a D-flat and not a C-sharp.
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
 * Every pitch in the source, one line per part and measure, read straight
 * from the XML. Deliberately not routed through the converter's reader: the
 * point is to disagree with it when it is wrong.
 *
 * A transposing part is written at the pitch its player reads, and MNX states
 * the pitch the instrument sounds, so the source's own <transpose> is applied
 * here as well.
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
          // once. A voice sounds one note at a time, so it is one line in all
          // but a known dialect: closed-score hymnals write two lines in one
          // <voice>, laid over each other with <backup>. A note written where
          // its voice is still sounding therefore goes to another line of it:
          // the one it last sounded in wherever that has room, so a run
          // written as one run stays in one line, then the first line with
          // room, and a new line where every one is still sounding.
          //
          // Order within a line is document order, which is the order the
          // music has. A chord member belongs to the note it is chorded with,
          // and some exports (Sibelius) state no <voice> on it, so a chord
          // note without one inherits the voice in force. Neither a chord
          // member nor a grace note stands where the cursor is, so neither
          // chooses a line: both join the note they were written against.
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
              // start, which is what the converter does with it.
              position = Math.max(0, position)
              const duration = durationOf()
              const free = (line: SourceLine) => line.end <= position + SETTLED
              const last = held.lines[held.active]
              let index = last && free(last) ? held.active : held.lines.findIndex(free)
              if (index === -1) {
                index = held.lines.length
                held.lines.push({ end: 0, pitches: [] })
              }
              // A grace group waiting where this note stands is what leads
              // into it, so it belongs to whichever line the note takes.
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
                    alter: text('alter') === '' ? 0 : Number(text('alter')),
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
 * This follows MusicXML's cursor by hand: notes advance it, chord notes and
 * grace notes do not, and <backup> and <forward> move it directly. Each
 * duration is reduced to whole notes at the divisions in force where it
 * occurs, because <divisions> can change in the middle of a measure. Only a
 * note extends the measured length: a <forward> past the last note skips
 * time nothing is written in, which the converter rightly leaves silent.
 *
 * A <backup> may reach back further than the measure has run. The cursor
 * follows it out there, because a <forward> can bring it back, but a note
 * written before the measure starts is written at the start, which is what
 * the converter does with it. A chord note is the exception at both ends: it
 * joins the event before it rather than standing where the cursor is.
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
          // A chord note joins the event before it and writes nothing where
          // the cursor stands, so it is the one note that does not settle a
          // cursor carried before the measure start.
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

/** An event of the converted document, and where in the score it stands. */
interface PlacedEvent {
  item: { id?: string; slurs?: { target: string }[]; lyrics?: MNXLyrics }
  place: string
}

/**
 * Every event of the converted document with the place it begins. Walks each
 * voice's sequence, since a slur routinely runs between them.
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
  // Cursor arithmetic on one side subtracts its way back to the measure start
  // and lands a hair below zero, which prints with a sign the other side
  // never has. Rounded to where the two are read as the same point.
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
      at = placeEvents(item.content, at, (scale * outer) / inner, found)
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
    // Grace notes are squeezed in beside the event they ornament and take
    // none of its time, so every one of a group begins where that event does.
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
 * How long a <note> is drawn as, in whole notes: its <type> with its dots,
 * scaled by any <time-modification> around it. Undefined where the note
 * states no <type>, which leaves its <duration> the only statement of its
 * length.
 *
 * A source can disagree with itself here, writing a <duration> that is not
 * what the note is drawn as. The converter converts the written value and
 * reports the disagreement, so a place read from the source has to be read
 * the same way or the two sides measure the measure differently.
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
 * line it belongs to and its text. The cursor is followed by hand, the same
 * way sourceSlurSpans and sourceMeasureLengths follow it.
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
            // line on an event. A source occasionally writes the same
            // <lyric number="1"> twice on one note; counting both would
            // fault the converter for collapsing a duplicate that carries
            // nothing new. Which of the two is kept here does not matter
            // while they agree, and differingLyricLines is what reports it
            // where they differ.
            const perLine = new Map<string, string>()
            for (const lyric of item.children.filter((c) => c.name === 'lyric')) {
              // Every <text>, joined by whatever the source put between
              // them. Two syllables sung on one note are written as two
              // <text>s, and taking the first was this check making the same
              // mistake the converter used to: it would pass while half the
              // word was lost. Trimmed at the two ends, and with any line
              // break inside it dropped, the way the reader joins them:
              // whitespace around a syllable is layout, and so is a break a
              // pretty-printer wrote to put each <text> on its own line.
              // Nobody sings either. A no-break space is not layout and
              // stays, which is what the comparison is here to catch.
              //
              // The pattern is written out again rather than imported from
              // the reader, and the corpus run is what compares the two: an
              // edit to one and not the other fails there. Sharing the
              // constant would make that edit silent, which is the opposite
              // of what a check is for.
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
 * Placed rather than grouped by sequence: a voice written as two lines laid
 * over each other is two sequences, and the source states one voice, so the
 * two sides have no grouping in common. Where a syllable is sung is
 * something both can read without agreeing on how the lines divide, and it
 * says more than the grouping did, since a syllable moved to another note
 * shows here and did not show there.
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
 * Every slur in the converted document, as the two places it joins. The event
 * a slur is stated on carries no id of its own unless something points at it,
 * so each end is named by where it stands rather than by id.
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
 * The voice-and-number streams that must be left out even though they
 * balance and never nest, because the pair they would join is one another
 * voice's residue confirms from both sides: an unclosed start of the same
 * number in another voice, at the same measure as this pair's start or the
 * one right after, and separately an orphan stop of the same number in
 * another voice, at the same measure as this pair's stop or the one right
 * before. That is the source stating a slur crossing voices right there, on
 * both the measure the pair opens in and the measure it closes in, which a
 * coincidence touches at most one side of: two separate cross-voice slurs
 * reusing this voice's number can leave it with exactly one start and one
 * stop of its own, which reading alone cannot tell apart from a slur it
 * actually states.
 *
 * Confirmed from both sides rather than one, because a voice's own slur runs
 * past a stray, unrelated end in another voice often enough that one-sided
 * evidence would leave out slurs the voice plainly does state on its own.
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
 * The slurs the source states beyond doubt, as the two places each joins.
 *
 * MusicXML writes a measure one voice at a time, so within a voice the
 * document's order is usually the music's. A slur that opens and closes
 * there can be paired by reading alone, but only where the voice leaves no
 * room for doubt: its ends of that number must account for each other
 * exactly, and it must never hold two of them open at once. A voice whose
 * ends do not balance has slurs running to another voice, and one that nests
 * them leaves which start a stop closes open to reading. Both are what the
 * converter has to work out, so both are left out and this can disagree with
 * it rather than assume it.
 *
 * A measure where a voice sounds two lines at once is left out for the same
 * reason. There the document's order is not the music's: the second line is
 * written after the first and sounds under it, so a start and a stop written
 * one after the other may be in different lines, and pairing them by reading
 * alone would state a slur the source does not.
 *
 * A slur written on a chord member is left out too: the converter reports
 * those as a loss rather than carrying them.
 */
export function sourceSlurSpans(root: XmlElement): Set<string> {
  const spans = new Set<string>()

  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      // Every slur end of the part, gathered per voice and slur number in the
      // order it was read, so each stream can be judged as a whole.
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
          // How far each voice has sounded in this measure, and the voices
          // that wrote a note before their own end, which is a voice
          // sounding two lines at once.
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

      // A stream can balance by coincidence: see crossesVoicesInAMeasure.
      // Such a stream is left out below, the same as one that never balances
      // at all.
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
 * What a layout suppresses. A layout can state less than the part list does
 * and stay legal MNX: a staff with no label or labelref suppresses its
 * part's name, and a multi-staff part written as bare sibling staves loses
 * its grand staff. The schema requires neither, so this walk checks both:
 * every drawn part name stays reachable from the layout, and every
 * multi-staff part the layout draws sits in exactly one braced group made
 * of its own staves.
 */
export function layoutLosses(document: MNXDocument): string[] {
  const layouts = document.layouts ?? []

  // A multi-staff part needs a layout to state its grand staff, so a
  // document holding one and no layout has already lost the brace. Without
  // this, the checks below would pass vacuously on a document with no
  // layouts at all.
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

  // A braced group states one part's grand staff when it holds exactly that
  // part's staves, first to last, and nothing else. The barlines must be
  // stated as connected too: the schema declares no default, so a group
  // that leaves barlineStyle unsaid leaves the barlines split.
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
 * Every place the source states one lyric line twice on one note and the two
 * say different things. MNX states one lyric per line per event, so only one
 * of the two reaches the output.
 *
 * A note occasionally carries <lyric number="1"> twice saying the same thing,
 * which loses nothing. Reading the two without comparing them is what let a
 * real loss through: the check kept the last, exactly as the writer did, so
 * the two sides agreed about music the source did not write.
 *
 * Compared on the words and on the syllabic, which are the whole of what MNX
 * states for a verse on an event, so this and the reader call the same pairs
 * a loss.
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
          // A lyric with no <text> at all states no verse: one holding only an
          // <extend> continues a melisma under a later note, and there is no
          // syllable in it to lose.
          if (!pieces.some((c) => c.name === 'text')) continue
          // Every piece, joined and trimmed the way the reader joins them,
          // so a verse elided across two <text>s is compared whole. A
          // syllabic of "single" and none at all both mean a syllable
          // standing alone.
          const written = pieces
            .map((c) => c.text)
            .join('')
            .trim()
          // A syllable that is nothing but whitespace draws nothing, so the
          // reader states no verse for it. Compared as one, it would read as
          // a line's second verse disagreeing with its first, and fault the
          // converter for a loss that is not one.
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
 * Every key of the document that is present and set to undefined, named by
 * the path it sits at.
 *
 * MNX reads an absent key and one set to undefined as different things: an
 * absent bracket leaves the renderer to decide, where a stated one does not.
 * The writer builds optional keys conditionally, and neither the compiler nor
 * a comparison catches a condition that lets one through set to undefined:
 * toEqual passes over such a key and JSON.stringify drops it, so the emitted
 * text is the same and the document a consumer reads is not.
 */
/**
 * Where a sequence states a rest filling its measure and holds content
 * anyway, as "part 1 measure 3 voice 1". MNX states such a rest on the
 * sequence and requires its content to be empty, which the schema does not
 * carry: a sequence stating both passes validation and says two things at
 * once. Named rather than counted, so a failure says where to look.
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

export function undefinedKeys(value: unknown, path = 'mnx'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => undefinedKeys(item, `${path}[${String(index)}]`))
  }
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, held]) =>
    held === undefined ? [`${path}.${key}`] : undefinedKeys(held, `${path}.${key}`),
  )
}
