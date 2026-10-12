// Reading the part list: each part's names and instrument setup, and the part
// group edges.

import type { DocumentPath } from '../errors.js'
import { GENERATED_ID_KINDS, GENERATED_ID_PATTERN, MNX_ID_PATTERN, renamedId } from '../ids.js'
import type { GroupingItem, InstrumentSound } from '../model/score.js'
import type { WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import {
  attribute,
  child,
  children,
  peekAttribute,
  requireAttribute,
  trimmedText,
} from '../xml/tree.js'
import { drawnName, ElementReader } from './element.js'
import { GroupingBuilder } from './part-groups.js'
import { parseWholeNumber } from './numbers.js'
import type { ResolvedSound } from './state.js'

/**
 * The part list, read once. `names` holds only the names drawn, while
 * `listed` holds every part id the list introduces, named or not, so a part
 * whose name is hidden or absent is still known to be listed.
 */
export interface PartList {
  names: ReadonlyMap<string, string>
  shortNames: ReadonlyMap<string, string>
  listed: ReadonlySet<string>
  /** Each <score-part> by its id, for warnings about its entry. */
  scoreParts: ReadonlyMap<string, XmlElement>
  /** The instrument grouping the list draws, empty where it draws none. */
  grouping: readonly GroupingItem[]
  /** The instrument setup the list states, keyed by what the score holds it under. */
  sounds: ReadonlyMap<string, InstrumentSound>
  /**
   * What a note's <instrument> resolves to: the key the score holds the sound
   * under, and the name to draw. Keyed by the part that sets the instrument
   * up, then by the source's own instrument id, which is what a note names
   * and which MNX may not be able to state. An id belongs to the part whose
   * <score-part> declares it, so a note naming another part's id resolves to
   * nothing.
   */
  soundsByInstrument: ReadonlyMap<string, ReadonlyMap<string, ResolvedSound>>
}

/** The MIDI pitches a sound's midiNumber states. */
export const MIDI_NUMBERS = { lowest: 0, highest: 127 } as const

/**
 * Reads the part list: each part's names and instrument setup, and the part
 * group edges. Everything not read here is reported.
 */
export function readPartList(root: ElementReader, warnings: WarningCollector): PartList {
  const names = new Map<string, string>()
  const shortNames = new Map<string, string>()
  const listed = new Set<string>()
  const scoreParts = new Map<string, XmlElement>()
  const grouping = new GroupingBuilder()
  const sounds = new Map<string, InstrumentSound>()
  const soundsByInstrument = new Map<string, Map<string, ResolvedSound>>()
  // Generated keys for instrument ids MNX cannot state, running sound1,
  // sound2, ... and skipping any key already taken, so a rename cannot
  // collide with an id the source wrote. Sounds are the score's, so every
  // part's instruments are taken, including those of parts not read yet.
  let renamed = 0
  const instrumentIds = new Set(
    root
      .blocks('part-list')
      .flatMap((list) => children(list.element, 'score-part'))
      .flatMap((part) => children(part, 'score-instrument'))
      .flatMap((instrument) => peekAttribute(instrument, 'id') ?? []),
  )
  const LIST_PATH: DocumentPath = ['score-partwise', 'part-list']

  for (const list of root.blocks('part-list')) {
    // Both kinds are accounted for here and walked below through readers of
    // their own, which report each whole; the walk goes through the raw
    // children because a group's members are decided by document order
    // across the two kinds.
    list.skip('score-part', 'part-group')
    for (const element of list.element.children) {
      if (element.name === 'score-part') {
        const id = attribute(element, 'id')
        if (id !== undefined && listed.has(id)) {
          warnings.addWhole(
            'inconsistent:part-id',
            `The part list has an entry for part "${id}" already, and MNX names each part ` +
              'once. This entry is not converted.',
            { part: id },
            element,
          )
          continue
        }
        const scorePart = new ElementReader(element)
        if (id !== undefined) {
          listed.add(id)
          scoreParts.set(id, element)
          grouping.part(id)
        }

        const name = drawnName(scorePart, 'part-name')
        const shortName = drawnName(scorePart, 'part-abbreviation')
        if (id !== undefined) {
          if (name) names.set(id, name)
          if (shortName) shortNames.set(id, shortName)
        }

        // The instrument setup. A <score-instrument> names what plays the
        // part; what its reader passes over is reported by the sweep. A part
        // may set up several, one per kit component, so every block is read.
        const named = new Map<string, { name: string | undefined; element: XmlElement }>()
        for (const instrument of scorePart.blocks('score-instrument')) {
          const instrumentId = requireAttribute(instrument.element, 'id', LIST_PATH)
          const nameElement = instrument.child('instrument-name')
          const instrumentName = nameElement ? trimmedText(nameElement) : ''
          named.set(instrumentId, {
            name: instrumentName === '' ? undefined : instrumentName,
            element: instrument.element,
          })
        }

        // From a <midi-instrument> only <midi-unpitched> is taken: the
        // schema's sound has no home for the rest of a synthesizer setup, its
        // midiNumber being the MIDI pitch backing a percussion kit rather
        // than the patch a <midi-program> names, so the others are reported
        // by name. A block naming no <score-instrument> sets up nothing a
        // note can name, so it is left unread and reported whole.
        //
        // Nothing here is refused: a block naming no instrument, or a pitch
        // outside MIDI's range, is a playback detail. Whatever is not taken
        // here is reported by the sweep.
        const midiPitches = new Map<string, number>()
        for (const midi of scorePart.blocks('midi-instrument')) {
          const midiId = attribute(midi.element, 'id')
          if (midiId === undefined || !named.has(midiId)) continue
          const unpitched = child(midi.element, 'midi-unpitched')
          const stated = unpitched ? trimmedText(unpitched) : ''
          // MusicXML numbers these from 1 and MIDI from 0.
          const written = parseWholeNumber(stated)
          if (written === undefined) continue
          const pitch = written - 1
          if (pitch < MIDI_NUMBERS.lowest || pitch > MIDI_NUMBERS.highest) continue
          midi.child('midi-unpitched')
          midiPitches.set(midiId, pitch)
        }

        for (const [instrumentId, { name: instrumentName, element: instrument }] of named) {
          let key = instrumentId
          const fits = MNX_ID_PATTERN.test(key)
          if (!fits || GENERATED_ID_PATTERN.test(key)) {
            do {
              renamed += 1
              key = renamedId('instrument', renamed)
            } while (instrumentIds.has(key))
            warnings.add(
              'unrepresentable:instrument-id',
              fits
                ? `The instrument id "${instrumentId}" is shaped like the ids the converter ` +
                    `gives ${GENERATED_ID_KINDS}, and MNX states them all the same way, so the ` +
                    `instrument is renamed ${key}.`
                : `The instrument id "${instrumentId}" does not fit MNX's id, which is 1 to 256 ` +
                    `printable ASCII characters, so the instrument is renamed ${key}.`,
              id !== undefined ? { part: id } : {},
              instrument,
            )
          }
          sounds.set(key, {
            name: instrumentName,
            midiNumber: midiPitches.get(instrumentId),
          })
          if (id !== undefined) {
            const forPart = soundsByInstrument.get(id) ?? new Map<string, ResolvedSound>()
            forPart.set(instrumentId, { key, name: instrumentName })
            soundsByInstrument.set(id, forPart)
          }
        }

        scorePart.reportUnread(warnings, id !== undefined ? { part: id } : {})
      } else if (element.name === 'part-group') {
        const group = new ElementReader(element)
        grouping.edge(group, warnings, ['score-partwise', 'part-list'])
        group.reportUnread(warnings, {})
      }
    }
  }

  return {
    names,
    shortNames,
    listed,
    scoreParts,
    grouping: grouping.finish(warnings),
    sounds,
    soundsByInstrument,
  }
}
