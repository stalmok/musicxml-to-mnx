// Reading a <direction>: the dynamics, tempo marks and other instructions
// that sit between the notes rather than on them.
//
// A <direction> holds one or more <direction-type>s and appears at wherever
// the cursor has reached in the measure. A dynamic belongs to the part's
// measure at that position; a metronome mark belongs to the score's measure,
// since a tempo is the whole score's. Much of what a direction can carry has
// no home in MNX, and is reported.

import type { DocumentPath } from '../errors.js'
import { addFractions, compareFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { Coda, Dynamic, Fine, Segno, Tempo } from '../model/score.js'
import type { ReadJump, UndrawnSign } from './globalMeasures.js'
import { writtenAt } from './collector.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, trimmedText } from '../xml/tree.js'
import { readColor } from './color.js'
import { divisionsInForce, wholeNotesOf } from './divisions.js'
import type { ElementReader, Stated } from './element.js'
import { parseDecimal, parseExactDecimal, readIntegerInRange } from './numbers.js'
import type { GraceNotesAt } from './timeline.js'
import type { OpenHairpin, WedgeStop } from './spanners.js'
import { placementOf } from './marks.js'
import { measureLength } from './state.js'
import type { PartState } from './state.js'
import { elementLoss } from './unrepresentable.js'
import { PendingWording, reportLoneWording } from './wording.js'
import type { Wording } from './wording.js'
import { readDynamics } from './dynamics.js'
import { readMetronome } from './metronome.js'
import { readOctaveShift } from './octaveShifts.js'
import { readWedge } from './hairpins.js'
import { readSound, soundSigns } from './sounds.js'
import type { SoundTempo } from './sounds.js'

/** What one <direction> was found to carry. */
export interface DirectionReading {
  dynamics: Dynamic[]
  tempos: Stated<Tempo>[]
  segnos: Stated<Segno>[]
  codas: Stated<Coda>[]
  fines: Stated<Fine>[]
  jumps: Stated<ReadJump>[]
  /** Each <sound tempo> the direction states. */
  soundTempos: SoundTempo[]
  undrawn: Stated<UndrawnSign>[]
}

export function readDirection(
  element: ElementReader,
  position: Fraction,
  graceNotesAt: GraceNotesAt,
  measure: number,
  dynamicsBefore: number,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
  path: DocumentPath,
): DirectionReading {
  const reading: DirectionReading = {
    dynamics: [],
    tempos: [],
    segnos: [],
    codas: [],
    fines: [],
    jumps: [],
    soundTempos: [],
    undrawn: [],
  }

  // A direction says which staff it belongs under. A tempo is the score's,
  // but MNX states the staff on a dynamic. Stated only where the part has more
  // than one staff.
  const staffElement = element.child('staff')
  const named = staffElement ? readIntegerInRange(staffElement, path, 1, state.staves) : undefined
  const staff = state.staves > 1 ? named : undefined

  // Which side of the staff the direction is drawn on. MNX states it on the
  // dynamic and the octave shift.
  const placement = placementOf(element.element)

  const at = offsetPosition(element, position, state, warnings, context)

  // How many grace notes stand at the cursor and were written before this
  // direction. A span stopping there is drawn over them, so its end names the
  // last of them rather than the place they all share. An octave shift reads
  // its end from the cursor whatever an <offset> says, so it counts them
  // either way. A hairpin is drawn where the offset puts it, and grace notes
  // are counted only where that is the cursor: the source says nothing about
  // which grace note an offset falls beside, so none is named.
  const graceAtCursor = graceNotesAt(position, staff)
  const overGrace = compareFractions(at, position) === 0 ? graceAtCursor : 0

  for (const directionType of element.blocks('direction-type')) {
    // The wording is held for the whole <direction-type>: MusicXML allows
    // the words and the mark they qualify in sibling <dynamics> blocks, and
    // "cresc." beside a <wedge> is the hairpin's own wording.
    const wording = new PendingWording()
    let lastMark: SuffixTarget | undefined
    for (const found of directionType.element.children) {
      // Each case accounts for the child it handles. A type read plainly is
      // swept with the other read children. A <dynamics> and a <metronome>
      // have a reader of their own, and the sweep reports what that reader
      // leaves unread. An unhandled type is reported whole below.
      switch (found.name) {
        case 'dynamics': {
          const marks = readDynamics(
            directionType.block(found),
            at,
            staff,
            placement,
            wording,
            warnings,
            context,
          )
          reading.dynamics.push(...marks)
          const last = marks[marks.length - 1]
          if (last) lastMark = { kind: 'mark', mark: last }
          break
        }
        case 'metronome':
          for (const tempo of readMetronome(directionType.block(found), at, warnings, context)) {
            reading.tempos.push({ value: tempo, element: found })
          }
          break
        case 'octave-shift':
          // Read plainly, being an empty element.
          directionType.children('octave-shift')
          readOctaveShift(
            found,
            at,
            position,
            graceAtCursor,
            measure,
            staff,
            placement,
            state,
            warnings,
            context,
          )
          break
        case 'wedge': {
          // Read plainly, being an empty element.
          directionType.children('wedge')
          const wedge = readWedge(
            found,
            at,
            overGrace,
            measure,
            dynamicsBefore + reading.dynamics.length,
            staff,
            placement,
            state,
            warnings,
            context,
          )
          if (wedge?.edge === 'start') {
            const prefix = wording.take()
            if (prefix !== undefined) wedge.hairpin.prefix = prefix.text
            lastMark = { kind: 'mark', mark: wedge.hairpin }
          } else if (wedge) {
            // Wording at a closing edge trails the mark. Words pending at the
            // stop wait on it until the pairing names the hairpin. Wording
            // after the stop closes the same stop.
            const suffix = wording.take()
            if (suffix !== undefined) {
              wedge.stop.wording = {
                text: suffix.text,
                where: writtenAt(suffix.element, context, warnings),
              }
            }
            lastMark = { kind: 'stop', stop: wedge.stop }
          }
          break
        }
        case 'segno':
          // Read plainly, being an empty element.
          directionType.children('segno')
          // A segno belongs to the score's measure, like a tempo, not to the
          // part it is written in.
          reading.segnos.push({ value: readSign(found, at, warnings, context), element: found })
          break
        case 'coda':
          // Read plainly, being an empty element.
          directionType.children('coda')
          // Belongs to the score's measure, like a segno.
          reading.codas.push({ value: readSign(found, at, warnings, context), element: found })
          break
        default: {
          // Accounted for by the warning below, which names the whole of it.
          directionType.skip(found.name)
          const loss = elementLoss(found.name)
          warnings.add(loss.code, `A <${found.name}> direction ${loss.ending}`, context, found)
        }
      }
    }

    // Wording left over closes the mark before it.
    const trailing = wording.take()
    if (trailing !== undefined) {
      closeWithWording(
        lastMark,
        { text: trailing.text, where: writtenAt(trailing.element, context, warnings) },
        warnings,
      )
    }
  }

  // A segno, a coda and a tempo are drawn above the staff, and MNX states no
  // side for any of them, so only one placed below loses its side. A dynamic
  // beside it takes the placement and keeps it.
  const sideless = reading.segnos.length + reading.codas.length + reading.tempos.length
  if (placement === 'below' && sideless > 0) {
    warnings.add(
      'unrepresentable:attribute',
      'This <direction> places a segno, a coda or a tempo below the staff, and MNX ' +
        'states no side for any of them. The mark is converted without its placement.',
      context,
      element.element,
      'placement',
    )
  }

  // Read after the direction types, so that a <metronome> beside it has
  // already had its say about the tempo. Whether a <sound tempo> echoes a
  // mark waits for the end of the score, because the mark can be drawn by a
  // later <direction> at the same point, or by another part.
  for (const sound of element.blocks('sound')) {
    const soundReading = readSound(sound, at, warnings, context)
    if (soundReading.fine) reading.fines.push({ value: soundReading.fine, element: sound.element })
    reading.jumps.push(
      ...soundReading.jumps.map((jump) => ({ value: jump, element: sound.element })),
    )
    if (soundReading.tempo) reading.soundTempos.push(soundReading.tempo)
    reading.undrawn.push(...soundSigns(soundReading, sound.element))
  }

  return reading
}

/**
 * Where the direction belongs: where the cursor has reached, plus whatever
 * <offset> says. The offset is often negative, to pull a mark written after
 * its note back on to it.
 */
function offsetPosition(
  element: ElementReader,
  position: Fraction,
  state: PartState,
  warnings: WarningCollector,
  context: ReportContext,
): Fraction {
  const offset = element.child('offset')
  if (!offset) return position

  const written = trimmedText(offset)
  // MusicXML measures an offset in divisions and allows a fractional one. One
  // that is not a number, or cannot be read exactly, is reported, and the mark
  // stays where it was written.
  if (parseDecimal(written) === undefined) {
    warnings.add(
      'unresolved:element-value',
      `An <offset> of "${written}" is not a number of divisions, and is not applied.`,
      context,
      offset,
    )
    return position
  }
  const count = parseExactDecimal(written)
  if (count === undefined) {
    warnings.add(
      'unsupported:element',
      `An <offset> of "${written}" divisions cannot be read exactly, and is not applied.`,
      context,
      offset,
    )
    return position
  }

  const divisions = divisionsInForce(state, warnings, context, offset)
  const moved = addFractions(position, wholeNotesOf(count, divisions))

  // MNX states a position within its measure, counting from the start, so a
  // mark an offset carries out of it has nowhere to go. Moving it into the
  // next or previous measure is not built yet.
  if (compareFractions(moved, fraction(0)) < 0 || pastTheEnd(moved, state)) {
    warnings.add(
      'unsupported:element',
      `An <offset> of ${written} carries the mark outside its measure, and is not applied.`,
      context,
      offset,
    )
    return position
  }

  return moved
}

/**
 * Whether a position runs past the end of the measure, as far as the time
 * signature in force says. Unknowable before any time signature is stated.
 * A measure does not always match its time signature, so this catches only a
 * mark past the stated length.
 */
function pastTheEnd(position: Fraction, state: PartState): boolean {
  const measure = measureLength(state)
  return measure !== undefined && compareFractions(position, measure) > 0
}

/**
 * What wording trailing a mark can be put on. A hairpin's stop is not a mark
 * yet, so it holds the words until the pairing names the hairpin.
 */
type SuffixTarget =
  { kind: 'mark'; mark: Dynamic | OpenHairpin } | { kind: 'stop'; stop: WedgeStop }

/**
 * Puts wording on the mark it trails, as that mark's suffix, and reports it
 * where nothing takes it.
 *
 * The mark cannot have a suffix yet. This runs once for each
 * <direction-type>, on a mark read in it. A stop already worded on the other
 * side keeps the first wording, because the source wrote both.
 */
function closeWithWording(
  target: SuffixTarget | undefined,
  wording: Wording,
  warnings: WarningCollector,
): void {
  if (target?.kind === 'mark') target.mark.suffix = wording.text
  else if (target?.kind === 'stop' && target.stop.wording === undefined) {
    target.stop.wording = wording
  } else reportLoneWording(wording, warnings)
}

/**
 * A segno or a coda drawn as a direction, at the point the direction sits. The
 * optional smufl attribute names a specific glyph, which MNX carries as the
 * sign's glyph.
 */
function readSign(
  found: XmlElement,
  at: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): Segno & Coda {
  return {
    location: at,
    glyph: attribute(found, 'smufl'),
    color: readColor(found, warnings, context),
  }
}
