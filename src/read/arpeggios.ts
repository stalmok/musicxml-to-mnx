// Reading and gathering the chords of a measure marked as rolled or struck
// together. MusicXML marks every note of the chord. MNX states the mark once,
// on the measure, spanning the notes it runs between, so the span is worked
// out once the measure is whole.

import type { Fraction } from '../fraction.js'
import type {
  Arpeggio,
  Event,
  KitComponent,
  KitNote,
  Note,
  Pitch,
  TieTarget,
} from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { upOrDown } from './marks.js'

/**
 * Where a pitch is drawn on a staff of the part, in steps from the middle
 * line, as the part stood at the chord. Nothing where no clef places it.
 */
export type PitchHeight = (pitch: Pitch, staff: number) => number | undefined

/** A chord marked as rolled or struck, held until its notes are all in. */
interface MarkedArpeggio {
  event: Event
  /**
   * The notes that carried this mark. They are what the roll spans where the
   * chord is divided between two numbered rolls; anywhere else the chord it
   * sits on is what the roll spans, because that is what is drawn.
   */
  notes: Note[]
  position: Fraction
  /**
   * The number the source gives it, if any. Two chords
   * sounding together under the same number are one arpeggio rolled across
   * both, which is how a pianist's two hands are rolled as one gesture;
   * different numbers are two separate rolls. A marker stating no number
   * joins nothing beyond its own chord, because only a number joins two
   * chords.
   */
  number: string | undefined
  struck: boolean
  /**
   * The <arpeggiate> or <non-arpeggiate> the mark was written with. A roll is
   * reported once the measure is whole, so the element comes along with it.
   */
  element: XmlElement
  /** The mark marking the same chord the other way, where one does. */
  conflicted: XmlElement | undefined
  /** The mark rolling the same chord in the other direction, where one does. */
  crossed: XmlElement | undefined
  direction: 'up' | 'down' | undefined
  arrow: boolean
  heightOf: PitchHeight
}

/**
 * Where a note sits on the staff, as a number that orders it against others.
 * Diatonic rather than chromatic, because a bracket spans what is drawn, and
 * two notes a semitone apart can be drawn on the same line.
 */
function staffOrder(pitch: Pitch): number {
  return pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.step)
}

/**
 * The notes of chords struck on a kit, bottom to top as they are drawn: the
 * lower staff first, then by height on the staff. A kit note is placed by the
 * component it strikes, and a pitched note sounding with it by the clef
 * drawing it. Nothing where a pitched note has no clef to place it.
 */
function drawnOrder(
  chords: readonly {
    notes: readonly Note[]
    kitNotes: readonly KitNote[]
    marked: MarkedArpeggio
  }[],
  kit: ReadonlyMap<string, KitComponent>,
  staffOf: (event: Event) => number | undefined,
): readonly TieTarget[] | undefined {
  const placed: { note: TieTarget; staff: number; height: number }[] = []
  for (const { notes, kitNotes, marked } of chords) {
    const eventStaff = staffOf(marked.event)
    for (const note of notes) {
      const staff = note.staff ?? eventStaff ?? 1
      const height = marked.heightOf(note.pitch, staff)
      if (height === undefined) return undefined
      placed.push({ note, staff, height })
    }
    for (const [component, { staffPosition }] of kit) {
      for (const note of kitNotes.filter((one) => one.component === component)) {
        placed.push({ note, staff: note.staff ?? eventStaff ?? 1, height: staffPosition })
      }
    }
  }
  return placed.sort((a, b) => b.staff - a.staff || a.height - b.height).map(({ note }) => note)
}

/** What an event sounds, which for a rest is nothing. */
function soundOf(event: Event): { notes: readonly Note[]; kitNotes: readonly KitNote[] } {
  return event.body.kind === 'notes' ? event.body : { notes: [], kitNotes: [] }
}

/** The marked chords of one measure, held until its notes are all in. */
export class Arpeggios {
  readonly #marked: MarkedArpeggio[] = []

  /**
   * Marks the event a note just joined as rolled, or as struck together. Both
   * are drawn beside the chord rather than on one of its notes, so MNX states
   * them on the measure, spanning the notes they run between.
   */
  mark(
    { event, start: position }: { event: Event; start: Fraction },
    /** The note the mark was written on, or nothing where a rest carried it. */
    note: Note | undefined,
    number: string | undefined,
    struck: boolean,
    direction: 'up' | 'down' | undefined,
    arrow: boolean,
    /** The element the mark is written with, for the report that comes later. */
    element: XmlElement,
    /** Places the chord's pitches on the staff, as the part stands at the chord. */
    heights: () => PitchHeight,
  ): void {
    // Every note of a chord carries the mark, so the first one to arrive sets
    // it up and the rest join what it already covers. Marks on one chord are
    // that chord's own roll however the source numbers them, because sources
    // number one note and leave the next bare. Only two stated numbers that
    // differ are two rolls.
    const existing = this.#marked.find(
      (found) =>
        found.event === event &&
        (found.number === undefined || number === undefined || found.number === number),
    )
    if (existing) {
      if (note) existing.notes.push(note)
      // A stated number claims a join with another chord's mark, so it stands
      // where the mark it joins stated none.
      existing.number ??= number
      // One roll cannot go both ways, so a second direction is a loss rather
      // than a detail: the first stands and the other is reported.
      if (
        existing.direction !== undefined &&
        direction !== undefined &&
        existing.direction !== direction
      ) {
        existing.crossed ??= element
      }
      existing.direction ??= direction
      existing.arrow ||= arrow
      // Rolled and struck together are opposite instructions.
      if (existing.struck !== struck) existing.conflicted ??= element
      return
    }

    this.#marked.push({
      event,
      notes: note ? [note] : [],
      position,
      number,
      struck,
      element,
      conflicted: undefined,
      crossed: undefined,
      direction,
      arrow,
      heightOf: heights(),
    })
  }

  /** Whether a mark rolls or brackets this event. */
  isMarked(event: Event): boolean {
    return this.#marked.some((marked) => marked.event === event)
  }

  /**
   * The rolled and struck chords of the measure.
   *
   * Marks sounding at the same point under the same number are one roll,
   * across however many chords carry them, so they are gathered before the
   * span is worked out. The span names the first-played note first, which for
   * a roll going downwards is the highest.
   *
   * A mark stating no number is gathered by the event it sits on instead, so
   * it joins the rest of its own chord and nothing beyond it. By the event
   * rather than by where it sits: a grace chord takes no time, so it begins
   * where the chord it decorates does, and the two are still two chords.
   */
  settle(
    warnings: WarningCollector,
    context: ReportContext,
    /** The components this part strikes, which is where a kit note's height is. */
    kit: ReadonlyMap<string, KitComponent>,
    /** The staff an event of the measure was placed on, where the part has more than one. */
    staffOf: (event: Event) => number | undefined,
  ): Arpeggio[] {
    // Marks on one chord are compared together first, whatever they are
    // numbered, so a chord marked rolled on one note and struck on another is
    // seen as one chord.
    const kept: MarkedArpeggio[] = []
    for (const marked of this.#marked) {
      const first = kept.find((one) => one.event === marked.event)
      if (first && first.struck !== marked.struck) {
        warnings.add(
          'inconsistent:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          context,
          marked.element,
        )
        continue
      }
      kept.push(marked)
    }

    // A chord whose notes are numbered two different ways is two rolls, each
    // over the notes that carried its own mark: a pianist rolls the lower
    // half and the upper half apart. Marked once, the chord is what the roll
    // spans, because the roll is drawn beside the whole chord and sources
    // mark one note of it and leave the rest bare.
    const seen = new Set<Event>()
    const divided = new Set<Event>()
    for (const one of kept) {
      if (seen.has(one.event)) divided.add(one.event)
      seen.add(one.event)
    }

    const groups = new Map<string, MarkedArpeggio[]>()
    for (const marked of kept) {
      const key =
        marked.number === undefined
          ? `event ${marked.event.id}`
          : `${String(marked.position.num)}/${String(marked.position.den)}|number ${marked.number}`
      groups.set(key, [...(groups.get(key) ?? []), marked])
    }

    const arpeggios: Arpeggio[] = []
    for (const group of groups.values()) {
      const first = group[0]
      /* v8 ignore next -- a group exists because something was put in it. */
      if (!first) continue

      const chords = group.map((marked) => ({
        notes: divided.has(marked.event) ? marked.notes : soundOf(marked.event).notes,
        kitNotes: soundOf(marked.event).kitNotes,
        marked,
      }))
      const notes = chords.flatMap((chord) => chord.notes)
      const kitNotes = chords.flatMap((chord) => chord.kitNotes)
      // A chord struck on a percussion kit carries no pitches to order by, so
      // it is ordered as it is drawn, by staff and by the height the part's
      // kit draws each component at. A mark is written on a note and a kit
      // note carries none, so such a roll spans the whole chord. A chord
      // sounding on a pitched staff and a kit at once is ordered as it is
      // drawn too, since a pitch and a component's height compare only on the
      // staff. Where marks numbered two ways divide such a chord, which roll a
      // kit note belongs to is not known.
      const drawn =
        kitNotes.length > 0 && (notes.length === 0 || !group.some((one) => divided.has(one.event)))
          ? drawnOrder(chords, kit, staffOf)
          : undefined
      const ordered: readonly TieTarget[] =
        drawn ?? [...notes].sort((a, b) => staffOrder(a.pitch) - staffOrder(b.pitch))

      if (ordered.length === 0) {
        // MNX states a roll as the two notes it runs between, and there are
        // none to name.
        warnings.add(
          'unsupported:element',
          (first.struck
            ? 'A rest is bracketed as struck together, and a bracket runs between notes, '
            : 'A rest is marked as rolled, and a roll runs between notes, ') +
            'so it is not carried over.',
          context,
          first.element,
        )
        continue
      }

      // A struck bracket runs between its bottom and top ends, each written
      // on its own note. A lone marker with one note under it is half a
      // bracket: written out, it would span the note to itself.
      if (first.struck && ordered.length === 1) {
        warnings.add(
          'unclosed:spanner',
          'A bracket marking notes as struck together has only one note under it, ' +
            'and is not carried over.',
          context,
          first.element,
        )
        continue
      }

      // Kit notes left unordered sound beside pitched notes that no clef
      // places, or in a divided chord, so the span runs over the pitched
      // notes alone. MNX reads the notes a mark covers as the ones whose pitch
      // lies between its ends, so a kit note left out of the span is left out
      // of the mark. Reported here rather than above, where the mark may
      // still turn out not to be carried.
      if (kitNotes.length > 0 && drawn === undefined) {
        warnings.add(
          'unsupported:element',
          `A chord ${first.struck ? 'bracketed as struck together' : 'rolled'} across a ` +
            'pitched staff and a percussion kit is carried over its pitched notes only, ' +
            'which is not the whole chord.',
          context,
          first.element,
        )
      }

      // Marks numbered two ways divide a chord into two, each over the notes
      // that carried its own mark. A mark is written on a note and a kit note
      // carries none, so which of them each number covers is not known, and
      // both come out over the whole chord.
      if (notes.length === 0 && group.some((one) => divided.has(one.event))) {
        warnings.add(
          'unsupported:element',
          'A chord struck on a percussion kit is marked twice under different numbers, ' +
            'and which notes each covers is not known. Each is carried over the whole ' +
            'chord.',
          context,
          first.element,
        )
      }

      const crossed = group.find((one) => one.crossed)?.crossed
      if (crossed) {
        warnings.add(
          'inconsistent:arpeggio',
          'A chord is rolled upwards by one mark and downwards by another. The first ' +
            'is the one converted.',
          context,
          crossed,
        )
      }

      const conflicted =
        group.find((one) => one.conflicted)?.conflicted ??
        group.find((one) => one.struck !== first.struck)?.element
      if (conflicted) {
        warnings.add(
          'inconsistent:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          context,
          conflicted,
        )
      }

      const lowest = ordered[0]
      const highest = ordered.at(-1)
      /* v8 ignore next -- the list is not empty, so it has both ends. */
      if (!lowest || !highest) continue

      // MusicXML rolls from the lowest note up unless it says otherwise.
      const direction = first.direction ?? 'up'
      const span =
        direction === 'down'
          ? { start: highest.id, end: lowest.id }
          : { start: lowest.id, end: highest.id }
      arpeggios.push(
        first.struck
          ? { kind: 'struck', position: first.position, span }
          : { kind: 'rolled', position: first.position, span, direction, arrow: first.arrow },
      )
    }
    return arpeggios
  }
}

/**
 * Whether the chord this note belongs to is rolled, or bracketed as struck
 * together. MusicXML marks every note of the chord; MNX states it once, over
 * the notes it runs between, so the mark is passed to the collector and the
 * span worked out once the chord is complete.
 */
export function readArpeggio(
  notations: readonly ElementReader[],
  placed: { event: Event; start: Fraction },
  arpeggios: Arpeggios,
  /** The note carrying these notations, or nothing where a rest carries them. */
  note: Note | undefined,
  heights: () => PitchHeight,
): void {
  for (const block of notations) {
    for (const rolled of block.children('arpeggiate')) {
      // MusicXML states a direction only when an arrowhead is drawn, and
      // rolls from the lowest note up when it states none.
      const direction = upOrDown(attribute(rolled, 'direction'))
      // The number is what joins one chord's mark to another's, so an absent
      // one is passed on absent: a default would make every unnumbered mark in
      // the measure claim the same roll.
      arpeggios.mark(
        placed,
        note,
        attribute(rolled, 'number'),
        false,
        direction,
        direction !== undefined,
        rolled,
        heights,
      )
    }
    // <non-arpeggiate> says the opposite: a bracket meaning the notes are
    // struck together. Its type names which end of the bracket this note is,
    // which MNX has no use for, since the span already says where it runs;
    // it is read here only so the sweep knows it is accounted for.
    for (const struck of block.children('non-arpeggiate')) {
      attribute(struck, 'type')
      arpeggios.mark(
        placed,
        note,
        attribute(struck, 'number'),
        true,
        undefined,
        false,
        struck,
        heights,
      )
    }
  }
}
