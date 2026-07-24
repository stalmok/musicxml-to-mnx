// The loss report. Anything MusicXML expresses that this converter does not
// carry into MNX is reported here rather than dropped. A pipeline can then
// gate on "zero warnings" and have that mean something.
//
// Every warning falls into one of three kinds, and the code's prefix says
// which. That distinction is the point of the report rather than a detail: a
// gap in the converter may close in a later release, a limit of MNX will not,
// and anyone deciding whether a file is worth reconverting later has to be
// able to tell them apart without reading the prose.
//
//   unsupported:*      a gap here. MNX can state it; this converter does not
//                      carry it over yet, and a later release may.
//   unrepresentable:*  a limit of MNX. There is nowhere in the output format
//                      to put it, so no release will carry it while the
//                      format stays as it is.
//   anything else      the source disagreeing with itself, and what the
//                      converter did about it.

// Stable, machine-readable codes. Consumers match on these, so a code's
// meaning must never change once released; add a new one instead.
export type WarningCode =
  // --- A gap in this converter ------------------------------------------
  // An element carrying notation this converter does not convert yet.
  | 'unsupported:element'

  // --- A limit of MNX ---------------------------------------------------
  // An element MNX has nowhere to put at all.
  | 'unrepresentable:element'
  // A measure labelled with something other than a number, where MNX's
  // measure number is an integer.
  | 'unrepresentable:measure-label'
  // The staves of a part are in different keys, or different time signatures,
  // and MNX states one of each for the whole score.
  | 'unrepresentable:per-staff-key'
  | 'unrepresentable:per-staff-time'
  // A chord whose notes are on different staves. MNX states the staff on the
  // event, so one chord cannot straddle two of them.
  | 'unrepresentable:chord-staff'
  // A stem that neither points up nor down. MNX states only those two.
  | 'unrepresentable:stem-direction'
  // A tempo written as one note value equalling another. MNX states a tempo
  // as a note value and a count of them per minute, which has no room for it.
  | 'unrepresentable:tempo'
  // A verse whose elided syllables each say how they join their word. MNX
  // states one lyric type for the whole event.
  | 'unrepresentable:lyric-syllabic'
  // An event carrying more than one fermata. MNX states one per event.
  | 'unrepresentable:fermata'
  // An event carrying two marks of one kind. MNX keys them by name.
  | 'unrepresentable:marking'
  // A chord marked both as rolled and as struck together at once.
  | 'unrepresentable:arpeggio'
  // A barline drawn at the opening edge of a measure. MNX states the one that
  // closes a measure.
  | 'unrepresentable:barline'
  // Two clefs written at the same point on the same staff, where MNX draws
  // one. The last declared is the one the following notes obey.
  | 'unrepresentable:clef'
  // A measure marked senza misura is unmetered, and MNX states meter as a
  // time signature or nothing. The measure carries no time signature.
  | 'unrepresentable:senza-misura'

  // --- The source disagreeing with itself -------------------------------
  // A part's id has no matching entry in the part list, so its name and any
  // other part-list detail are unavailable.
  | 'unresolved:part-id'
  // A note's written value and its measured duration disagree, outside a
  // tuplet where they are meant to. The written value is the one converted.
  | 'inconsistent:duration'
  // A tuplet whose written content does not add up to its stated ratio. The
  // content is converted as written.
  | 'inconsistent:tuplet'
  // A tie or slur has only one of its two ends, so there is nothing to join
  // it to. Real scores contain these, so it is reported rather than refused.
  | 'unclosed:spanner'
  // A first or second time bracket with only one of its two ends.
  | 'unclosed:ending'
  // A part holds a different number of measures from the score, so it stops
  // before the score does or runs past the end of it.
  | 'inconsistent:measure-count'

/**
 * True for a loss no release of this converter can close, short of MNX itself
 * gaining somewhere to put it. The prefix is the contract; this saves every
 * consumer writing the same string test.
 */
export function isFormatLimit(code: WarningCode): boolean {
  return code.startsWith('unrepresentable:')
}

export interface WarningContext {
  /** The MusicXML part id the warning came from, when known. */
  part?: string
  /** The measure number as written in the source, when known. */
  measure?: number
  /** Line in the source document, when known. */
  line?: number
}

export interface ConversionWarning {
  readonly code: WarningCode
  readonly message: string
  /**
   * The MusicXML element the loss is about, without its angle brackets, where
   * it is about one. A field rather than something to be recovered from the
   * message, because grouping a report by what was lost is the first thing
   * anyone does with it, and the message is prose written for a person.
   */
  readonly element: string | undefined
  readonly context: WarningContext
}

export class WarningCollector {
  readonly #warnings: ConversionWarning[] = []

  add(code: WarningCode, message: string, context: WarningContext, element?: string): void {
    this.#warnings.push({ code, message, element, context })
  }

  /** A copy, so the report cannot be mutated from outside. */
  list(): readonly ConversionWarning[] {
    return [...this.#warnings]
  }
}
