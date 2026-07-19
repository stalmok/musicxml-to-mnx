// The loss report. Anything MusicXML expresses that this converter does not
// carry into MNX, whether because MNX cannot express it or because the
// construct isn't handled yet, is reported here rather than dropped. A
// pipeline can then gate on "zero warnings" and have that mean something.

// Stable, machine-readable codes. Consumers match on these, so a code's
// meaning must never change once released; add a new one instead.
export type WarningCode =
  // An element the converter does not (yet) convert was found and skipped.
  | 'unsupported:element'
  // A measure is labelled with something other than a number, which MNX has
  // nowhere to put.
  | 'unsupported:measure-label'
  // A part's id has no matching entry in the part list, so its name and any
  // other part-list detail are unavailable.
  | 'unresolved:part-id'
  // A note's written value and its measured duration disagree, outside a
  // tuplet where they are meant to. The written value is the one converted.
  | 'inconsistent:duration'

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
  readonly context: WarningContext
}

export class WarningCollector {
  readonly #warnings: ConversionWarning[] = []

  add(code: WarningCode, message: string, context: WarningContext): void {
    this.#warnings.push({ code, message, context })
  }

  /** A copy, so the report cannot be mutated from outside. */
  list(): readonly ConversionWarning[] {
    return [...this.#warnings]
  }
}
