// The source-independent structural checks: what the music is, read once from
// the converter's MNX output and once from the MusicXML source, so the two
// can be held against each other. Nothing here goes through the converter's
// own reader, which is the point: it has to be able to disagree with it.
//
// Shared by the vendored corpus test and the full-corpus gate, so both hold
// the output to the same equivalence.

import type {
  MNXDocument,
  MNXLayoutStaff,
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

/** One line per part and measure: each voice's pitches in order, the voices
 * sorted. The voices sort because the source interleaves a measure's voices
 * through its cursor while MNX states each on its own, so their order is the
 * one thing the two sides may legitimately disagree on. A lost, changed, or
 * reordered pitch within a voice still shows. */
function measureLine(part: number, measure: number, voices: readonly string[]): string {
  const sounded = voices.filter((voice) => voice !== '')
  return `part ${String(part + 1)} measure ${String(measure + 1)}: ${sounded.sort().join(' | ')}`
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

/**
 * Every pitch in the source, one line per part and measure, read straight
 * from the XML. Deliberately not routed through the converter's reader: the
 * point is to disagree with it when it is wrong.
 */
export function sourcePitches(root: XmlElement): string[] {
  const lines: string[] = []
  root.children
    .filter((c) => c.name === 'part')
    .forEach((part, partIndex) => {
      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          // Grouped by voice in document order, which within one voice is the
          // order the music has. A chord member belongs to the note it is
          // chorded with, and some exports (Sibelius) state no <voice> on it,
          // so a chord note without one inherits the voice in force.
          const byVoice = new Map<string, string[]>()
          let voiceInForce = ''
          for (const note of measure.children.filter((c) => c.name === 'note')) {
            const isChord = note.children.some((c) => c.name === 'chord')
            const stated = note.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
            const voice = stated === '' && isChord ? voiceInForce : stated
            if (!isChord) voiceInForce = voice
            const pitch = note.children.find((c) => c.name === 'pitch')
            if (!pitch) continue
            const text = (name: string) =>
              pitch.children.find((c) => c.name === name)?.text.trim() ?? ''
            const list = byVoice.get(voice) ?? []
            list.push(
              pitchKey({
                step: text('step'),
                octave: Number(text('octave')),
                alter: text('alter') === '' ? 0 : Number(text('alter')),
              }),
            )
            byVoice.set(voice, list)
          }
          lines.push(
            measureLine(
              partIndex,
              measureIndex,
              [...byVoice.values()].map((v) => v.join(' ')),
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
  item: { id?: string; slurs?: { target: string }[] }
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

/**
 * The slurs the source states beyond doubt, as the two places each joins.
 *
 * MusicXML writes a measure one voice at a time, so within a voice the
 * document's order is the music's. A slur that opens and closes there can be
 * paired by reading alone, but only where the voice leaves no room for doubt:
 * its ends of that number must account for each other exactly, and it must
 * never hold two of them open at once. A voice whose ends do not balance has
 * slurs running to another voice, and one that nests them leaves which start
 * a stop closes open to reading. Both are what the converter has to work out,
 * so both are left out and this can disagree with it rather than assume it.
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
      const streams = new Map<string, { kind: string; at: string }[]>()
      let divisions = 1

      part.children
        .filter((c) => c.name === 'measure')
        .forEach((measure, measureIndex) => {
          let position = 0
          let voiceInForce = ''

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

            if (!isChord) {
              const here = place(partIndex, measureIndex, position)
              for (const notations of item.children.filter((c) => c.name === 'notations')) {
                for (const slur of notations.children.filter((c) => c.name === 'slur')) {
                  const kind = slur.attributes.type ?? ''
                  if (kind !== 'start' && kind !== 'stop') continue
                  const key = `${voice}|${slur.attributes.number ?? '1'}`
                  streams.set(key, [...(streams.get(key) ?? []), { kind, at: here }])
                }
              }
            }
            if (!isChord && !isGrace) position += durationOf()
          }
        })

      for (const ends of streams.values()) {
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
  if (layouts.length === 0) return []

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
