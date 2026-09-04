// Thrown for MusicXML input the converter cannot honestly convert: malformed
// structure, or values the format does not allow. Input that is valid but
// merely unconvertible produces a warning instead (see warnings.ts). Losing
// notation is reportable, not fatal.

// Where in the document the problem was found, as the trail of elements
// leading to it, for example ['part P1', 'measure 3', 'note']. Empty for
// document-level failures.
export type DocumentPath = readonly string[]

export function formatPath(path: DocumentPath): string {
  return path.join(' > ')
}

export interface ErrorLocation {
  /**
   * Required, so that a refusal cannot be thrown without saying where it was
   * found. Empty is the answer for a document-level failure, and stating it
   * is what makes that a decision rather than an omission.
   */
  path: DocumentPath
  line?: number
  /**
   * The document the problem was found in. Nothing inside the converter knows
   * it: a source is text or bytes, not a file. The caller names it, and the
   * conversion attaches it on the way out.
   */
  document?: string
  /** The lower-level failure this one wraps, kept for debugging. */
  cause?: unknown
}

function formatLocation(location: ErrorLocation): string {
  const parts: string[] = []
  if (location.document !== undefined) parts.push(`in ${location.document}`)
  const where = formatPath(location.path)
  if (where) parts.push(`at ${where}`)
  if (location.line !== undefined) parts.push(`line ${String(location.line)}`)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

export class MusicXMLError extends Error {
  readonly path: DocumentPath
  readonly line: number | undefined
  readonly document: string | undefined
  /**
   * The message without the location, which is what a caller grouping
   * refusals compares: the same refusal moves line and file between exports.
   * Held as a field so that reading it is not a matter of splitting `message`
   * back apart on the punctuation this file happens to write.
   */
  readonly detail: string

  constructor(message: string, location: ErrorLocation) {
    super(message + formatLocation(location), { cause: location.cause })
    this.name = 'MusicXMLError'
    this.detail = message
    this.path = location.path
    this.line = location.line
    this.document = location.document
  }

  /** The same refusal, restated against the document it was found in. */
  inDocument(document: string): MusicXMLError {
    return new MusicXMLError(this.detail, {
      path: this.path,
      ...(this.line === undefined ? {} : { line: this.line }),
      document,
      cause: this.cause,
    })
  }
}
