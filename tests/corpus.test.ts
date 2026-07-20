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
import { convertMusicXML } from '../src/index.js'
import type { MNXBeam, MNXDocument, MNXNoteValue, MNXSequenceItem } from '../src/index.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import type { XmlElement } from '../src/xml/parse.js'
import { schemaErrors } from './support/schema.js'
import { songs } from './support/corpus.js'
import baseline from './corpus/warning-baseline.json' with { type: 'json' }

// Converted once each, up front. Every check below reads the same result,
// rather than converting the same song six times over.
const attempted = songs().map((song) => {
  try {
    return { ...song, ...convertMusicXML(song.source), rejected: undefined }
  } catch (error) {
    return { ...song, rejected: error instanceof Error ? error.message : String(error) }
  }
})

const converted = attempted.filter((song) => song.rejected === undefined)

test('the whole corpus is present', () => {
  expect(attempted.length).toBe(Object.keys(baseline).length)
  expect(attempted.length).toBeGreaterThan(40)
})

// A song is refused only where converting it would mean handing back music
// the source did not write. Which songs those are is pinned here, so that one
// starting or ceasing to convert is a change somebody chose.
test('refuses only the songs it is known to refuse', () => {
  const refused = attempted
    .filter((song) => song.rejected !== undefined)
    // Without the location, which moves whenever a file is re-exported.
    .map((song) => `${song.name}: ${(song.rejected ?? '').split(' (at ')[0] ?? ''}`)

  expect(refused.sort()).toEqual(
    [
      'berlioz-2-le-spectre-de-la-rose',
      'davies-5-the-fly-and-the-humble-bee',
      'jaell-5-en-ramant',
    ].map((name) => `${name}: A tremolo written across two notes is not converted yet.`),
  )
})

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

function writtenLength(value: MNXNoteValue): number {
  const base = BASE_LENGTHS[value.base]
  if (base === undefined) throw new Error(`Unknown note value base: ${value.base}`)
  return base * (2 - 2 ** -(value.dots ?? 0))
}

/** How much of the measure an item occupies, which is not what it is written as. */
function sounding(item: MNXSequenceItem): number {
  if ('type' in item && item.type === 'space') return item.duration[0] / item.duration[1]
  // A grace note is squeezed in and takes no time.
  if ('type' in item && item.type === 'grace') return 0
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

interface Pitch {
  step: string
  octave: number
  alter: number
}

function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${String(pitch.octave)}${pitch.alter === 0 ? '' : `(${String(pitch.alter)})`}`
}

/** Every pitch in the converted document, in document order. */
function pitchesOf(document: MNXDocument): string[] {
  const found: string[] = []
  const walk = (items: readonly MNXSequenceItem[]): void => {
    for (const item of items) {
      if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
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
  for (const part of document.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) walk(sequence.content)
    }
  }
  return found
}

/**
 * Every pitch in the source, read straight from the XML. Deliberately not
 * routed through the converter's reader: the point is to disagree with it
 * when it is wrong.
 */
function sourcePitches(root: XmlElement): string[] {
  const found: string[] = []
  const walk = (element: XmlElement): void => {
    if (element.name === 'pitch') {
      const text = (name: string) =>
        element.children.find((c) => c.name === name)?.text.trim() ?? ''
      found.push(
        pitchKey({
          step: text('step'),
          octave: Number(text('octave')),
          alter: text('alter') === '' ? 0 : Number(text('alter')),
        }),
      )
      return
    }
    for (const child of element.children) walk(child)
  }
  walk(root)
  return found
}

/**
 * Every hairpin in the source, paired the way the music has them rather than
 * the way the document writes them: by measure, then by where in the measure
 * the cursor had reached, with a stop closing the most recently opened of its
 * number. Read straight from the XML, so it disagrees with the converter when
 * the converter is wrong.
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
        const waiting = open.get(end.number) ?? []
        const started = waiting.pop()
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
 * How long each measure of each part sounds in the source, counted in
 * divisions and reduced to whole notes. This follows MusicXML's cursor by
 * hand: notes advance it, chord notes and grace notes do not, and <backup>
 * and <forward> move it directly.
 */
function sourceMeasureLengths(root: XmlElement): number[][] {
  const perPart: number[][] = []

  for (const part of root.children.filter((c) => c.name === 'part')) {
    const lengths: number[] = []
    let divisions = 1

    for (const measure of part.children.filter((c) => c.name === 'measure')) {
      let position = 0
      let furthest = 0

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
          const isChord = item.children.some((c) => c.name === 'chord')
          const isGrace = item.children.some((c) => c.name === 'grace')
          if (!isChord && !isGrace) position += durationOf()
        }
        furthest = Math.max(furthest, position)
      }
      lengths.push(furthest / (divisions * 4))
    }
    perPart.push(lengths)
  }
  return perPart
}

describe.each(converted)('$name', ({ name, source, mnx, warnings }) => {
  test('produces MNX the spec schema accepts', () => {
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A voice may legitimately stop before the barline, so being short is fine.
  // Running past the end is not: it means time was invented.
  //
  // Measured against the source's own measure rather than the time signature,
  // because real scores contain measures that do not match it. One song here
  // writes five quarters in a 3/4 bar, and the converter carrying that over
  // faithfully is right.
  test('never writes a voice past the end of its measure', () => {
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

  // A beam, tie or slur names what it joins, and MNX writes an id only where
  // something names it. A reference with no named event behind it is a broken
  // document that the schema cannot see, since it checks the shape of an id
  // and not whether it leads anywhere.
  test('every reference leads to something named', () => {
    const named = new Set<string>()
    const collect = (items: readonly MNXSequenceItem[]): void => {
      for (const item of items) {
        if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
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
        if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
          fromSpanners(item.content)
          continue
        }
        if ('slurs' in item) referenced.push(...(item.slurs ?? []).map((slur) => slur.target))
        if ('notes' in item) {
          for (const note of item.notes ?? []) {
            referenced.push(...(note.ties ?? []).map((tie) => tie.target))
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

      part.measures.forEach((measure, index) => {
        for (const clef of measure.clefs ?? [])
          check(clef.staff, `measure ${String(index + 1)} clef`)
        for (const sequence of measure.sequences) {
          check(sequence.staff, `measure ${String(index + 1)} sequence`)
          for (const item of sequence.content) {
            if ('staff' in item) check(item.staff, `measure ${String(index + 1)} event`)
          }
        }
      })
    })

    expect(stray.slice(0, 5)).toEqual([])
  })

  // The words are the point of a song, so losing or mangling one is not a
  // detail. Gathered per voice and per verse, because the source interleaves
  // the voices of a measure through its cursor and may list a note's verses
  // in any order, while MNX states each voice on its own and keys the verses
  // by number. Compared verse-line by verse-line, both orderings fall away
  // and only a lost or changed syllable shows.
  test('keeps every lyric syllable the source wrote, in order', () => {
    // From MNX: each sequence is already one voice; split its syllables by
    // verse line.
    const fromMnx: string[] = []
    for (const part of mnx.parts) {
      for (const measure of part.measures) {
        for (const sequence of measure.sequences) {
          const byLine = new Map<string, string[]>()
          const collect = (items: readonly MNXSequenceItem[]): void => {
            for (const item of items) {
              if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
                collect(item.content)
                continue
              }
              if ('lyrics' in item && item.lyrics) {
                for (const [line, verse] of Object.entries(item.lyrics.lines)) {
                  const list = byLine.get(line) ?? []
                  list.push(verse.text)
                  byLine.set(line, list)
                }
              }
            }
          }
          collect(sequence.content)
          for (const [line, texts] of byLine) fromMnx.push(`${line}: ${texts.join(' ')}`)
        }
      }
    }

    // From the source: the same, grouped by the measure's voices.
    const fromSource: string[] = []
    const root = parseXmlRoot(source)
    for (const part of root.children.filter((c) => c.name === 'part')) {
      for (const measure of part.children.filter((c) => c.name === 'measure')) {
        const byVoiceLine = new Map<string, string[]>()
        for (const note of measure.children.filter((c) => c.name === 'note')) {
          const voice = note.children.find((c) => c.name === 'voice')?.text.trim() ?? ''
          for (const lyric of note.children.filter((c) => c.name === 'lyric')) {
            const key = `${voice}|${lyric.attributes.number ?? '1'}`
            // Every <text>, joined by whatever the source put between them.
            // Two syllables sung on one note are written as two <text>s, and
            // taking the first was this check making the same mistake the
            // converter used to: it would pass while half the word was lost.
            const text = lyric.children
              .filter((c) => c.name === 'text' || c.name === 'elision')
              .map((c) => c.text)
              .join('')
            if (text === '') continue
            const list = byVoiceLine.get(key) ?? []
            list.push(text)
            byVoiceLine.set(key, list)
          }
        }
        for (const [key, texts] of byVoiceLine) {
          fromSource.push(`${key.split('|')[1] ?? ''}: ${texts.join(' ')}`)
        }
      }
    }

    expect(fromMnx.sort()).toEqual(fromSource.sort())
  })

  // MusicXML draws an accidental exactly where it writes an <accidental>, so
  // the count of shown accidentals in the output must match the count in the
  // source. The schema types accidentalDisplay but cannot count.
  test('shows exactly the accidentals the source draws', () => {
    let shown = 0
    const walk = (items: readonly MNXSequenceItem[]): void => {
      for (const item of items) {
        if ('type' in item && (item.type === 'tuplet' || item.type === 'grace')) {
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
    let time = { count: 4, unit: 4 }

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        time = mnx.global.measures[index]?.time ?? time
        const barLength = time.count / time.unit
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
    const expected = sourceMeasureLengths(parseXmlRoot(source))
    const disagreements: string[] = []

    mnx.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure, index) => {
        // A full-measure rest states no length of its own: the time signature
        // does, and this check is about what the converter carried over.
        if (measure.sequences.some((sequence) => sequence.fullMeasure)) return

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

    expect(disagreements.slice(0, 5)).toEqual([])
  })

  // Losses may only shrink. A rise means something stopped being converted
  // that used to be; a fall means the baseline is due an update.
  test('loses no more than the recorded baseline', () => {
    // Grouped by the element lost, which the warning states as a field. It
    // used to be dug back out of the message with a regular expression, which
    // made the baseline turn on how a sentence happened to be worded.
    const counts: Record<string, number> = {}
    for (const warning of warnings) {
      const key = warning.element ?? warning.code
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
