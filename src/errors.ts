// Thrown for MusicXML input the converter cannot convert: malformed
// structure, or values the format does not allow. Valid input with notation
// the output cannot carry produces a warning instead (see warnings.ts).

// Where in the document the problem was found, as the trail of elements
// leading to it, for example ['part P1', 'measure 3', 'note']. Empty for
// document-level failures.
export type DocumentPath = readonly string[]

export function formatPath(path: DocumentPath): string {
  return path.join(' > ')
}

export interface ErrorLocation {
  /**
   * Required, so every refusal states where it was found. Empty for a
   * document-level failure.
   */
  path: DocumentPath
  line?: number
  /**
   * The document the problem was found in. The caller names it with the
   * `documentName` option, and `convertMusicXML` adds it.
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
   * The message without the location. Compare it to group the same refusal
   * across documents, where the line and the file differ.
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
    const named = new MusicXMLError(this.detail, {
      path: this.path,
      ...(this.line === undefined ? {} : { line: this.line }),
      document,
      cause: this.cause,
    })
    // The restated error is thrown from here, so its own stack would point at
    // this method rather than at the reader that refused the document.
    if (this.stack !== undefined) named.stack = this.stack
    return named
  }
}
