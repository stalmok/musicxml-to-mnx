// Gathering the chords of a measure marked as rolled or struck together.
// MusicXML marks every note of the chord. MNX states the mark once, on the
// measure, spanning the notes it runs between, so the span is worked out once
// the measure is whole.

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
 * The notes of a kit chord, bottom to top. Ordered by walking the kit in
 * height order rather than by looking each note's component up, so a
 * component the kit does not hold cannot come back as a height of nothing.
 */
function kitOrder(
  notes: readonly KitNote[],
  kit: ReadonlyMap<string, KitComponent>,
): readonly KitNote[] {
  return [...kit]
    .sort(([, a], [, b]) => a.staffPosition - b.staffPosition)
    .flatMap(([component]) => notes.filter((note) => note.component === component))
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

      const notes = group.flatMap((one) =>
        divided.has(one.event) ? one.notes : soundOf(one.event).notes,
      )
      const kitNotes = group.flatMap((one) => soundOf(one.event).kitNotes)
      // A chord struck on a percussion kit carries no pitches to order by, so
      // it is ordered by the height the part's kit draws each component at. A
      // mark is written on a note and a kit note carries none, so such a roll
      // spans the whole chord.
      const ordered: readonly TieTarget[] =
        notes.length > 0
          ? [...notes].sort((a, b) => staffOrder(a.pitch) - staffOrder(b.pitch))
          : kitOrder(kitNotes, kit)

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

      // A chord sounding on a pitched staff and a kit at once is spanned by
      // its pitched notes: a diatonic index and a staff height do not
      // compare, and ordering the two together would mean reading each pitch
      // against the clef drawing it. MNX reads the notes a mark covers as the
      // ones whose pitch lies between its ends, so a kit note left out of the
      // span is left out of the mark. Reported here rather than above, where
      // the mark may still turn out not to be carried.
      if (notes.length > 0 && kitNotes.length > 0) {
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
