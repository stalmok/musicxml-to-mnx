// Reading a <sound>: playback, and the navigation it carries.

import type { Fraction } from '../fraction.js'
import type { Fine } from '../model/score.js'
import type { ReadJump, UndrawnSign } from './globalMeasures.js'
import type { ReportContext, WarningCollector, WarningPlace } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader, Stated } from './element.js'
import { parseDecimal } from './numbers.js'
import { attributeLoss } from './unrepresentable.js'

/** The navigation a single <sound> element carries a home for. */
export interface SoundReading {
  fine: Fine | undefined
  /** In the order the <sound> states them. MNX states one per measure. */
  jumps: ReadJump[]
  /** The segno or coda the <sound> names, beside a sign or for playback only. */
  marks: UndrawnSign['kind'][]
  /**
   * The <sound tempo> the element states, where it states one. Whether it is
   * a loss depends on the metronome marks the score draws at the same point,
   * which any part can draw and can be written after the <sound>, so the
   * caller decides once the whole score is read.
   */
  tempo: SoundTempo | undefined
}

/** A <sound tempo> waiting on the score to say whether it echoes a mark. */
export interface SoundTempo {
  position: Fraction
  /**
   * Quarter notes per minute, which is what MusicXML's tempo attribute
   * counts. Absent where the attribute states no number. No mark is the echo
   * of an absent, zero or negative tempo, because every mark states a
   * positive one.
   */
  bpm: number | undefined
  element: XmlElement
  /**
   * The place kept in the report for the decision. The decision is made
   * once every part is read, and reporting it there would put it after every
   * loss read since; this holds its spot where the <sound> is written.
   */
  place: WarningPlace
}

// How long the final note of a movement sounds, in divisions. MusicXML writes
// it as a decimal, and XML's decimal allows every one of "8", "8.5", "8." and
// ".5", with a leading plus. A duration is never negative, so no minus.
const FINAL_NOTE_DURATION = /^\+?(\d+(\.\d*)?|\.\d+)$/

/** The segno and coda a <sound> names. */
export function soundSigns(sound: SoundReading, element: XmlElement): Stated<UndrawnSign>[] {
  return sound.marks.map((kind) => ({ value: { kind }, element }))
}

/**
 * A <sound> is mostly playback. Its tempo is playback, not notation: MNX's
 * tempo is always drawn, so a tempo written from a <sound> would draw a mark
 * the source did not. A <sound tempo> at the same point and tempo as a drawn
 * <metronome> echoes the mark and is not reported. Any other is reported as a
 * converter gap, because the schema does hold a tempo. The tempo comes back
 * for the caller to settle, because the mark can be written after the <sound>
 * or by another part. A velocity or a pan position has no home, and is reported as such.
 *
 * <sound fine> is a Fine, and <sound dalsegno>, <sound dacapo> and <sound
 * tocoda> are jumps. Each goes on the score's measure where the <sound> is
 * written. The rest is reported.
 */
export function readSound(
  sound: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): SoundReading {
  let fine: Fine | undefined
  const jumps: ReadJump[] = []
  const marks: UndrawnSign['kind'][] = []
  let tempo: SoundTempo | undefined
  for (const name of Object.keys(sound.element.attributes)) {
    if (name === 'tempo') {
      tempo = {
        position,
        bpm: parseDecimal((attribute(sound.element, 'tempo') ?? '').trim()),
        element: sound.element,
        place: warnings.reserve(),
      }
      continue
    }
    if (name === 'fine') {
      // MusicXML writes the fine as "yes", or as the divisions the final note
      // sounds for. Either marks the Fine, and the number is playback. Any
      // other value is reported, not read as a Fine.
      const written = (attribute(sound.element, 'fine') ?? '').trim()
      if (written === 'yes' || FINAL_NOTE_DURATION.test(written)) {
        fine = { location: position }
        continue
      }
      warnings.add(
        'unresolved:attribute-value',
        `The "fine" of a <sound> is "${written}", which is neither "yes" nor a duration.`,
        context,
        sound.element,
        'fine',
      )
      continue
    }
    // The attribute names the segno or the coda to jump to. MNX's jump goes
    // to the one sign of its kind the score draws, so the name is read and
    // says nothing more.
    if (name === 'dalsegno' || name === 'tocoda') {
      attribute(sound.element, name)
      jumps.push({ sound: name, location: position })
      continue
    }
    if (name === 'dacapo') {
      // A yes-no attribute: "no" states that there is no jump.
      const written = (attribute(sound.element, 'dacapo') ?? '').trim()
      if (written === 'yes') jumps.push({ sound: 'dacapo', location: position })
      if (written !== 'yes' && written !== 'no') {
        warnings.add(
          'unresolved:attribute-value',
          `The "dacapo" of a <sound> is "${written}", which is neither "yes" nor "no".`,
          context,
          sound.element,
          'dacapo',
        )
      }
      continue
    }
    // Names a sign, drawn beside it or marked for playback only. MNX has no
    // label for a segno or a coda, so the name is reported. An empty name
    // names nothing.
    if ((name === 'segno' || name === 'coda') && attribute(sound.element, name)) marks.push(name)
    // Classified by attribute name, not element name: <sound dynamics> is a
    // playback velocity with no home, unlike the <dynamics> element.
    const loss = attributeLoss('sound', name)
    warnings.add(
      loss.code,
      `The "${name}" of a <sound> ${loss.ending}`,
      context,
      sound.element,
      name,
    )
  }
  return { fine, jumps, marks, tempo }
}
