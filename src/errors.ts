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
  path?: DocumentPath
  line?: number
  /** The lower-level failure this one wraps, kept for debugging. */
  cause?: unknown
}

function formatLocation(path: DocumentPath, line: number | undefined): string {
  const where = formatPath(path)
  if (where && line !== undefined) return ` (at ${where}, line ${String(line)})`
  if (where) return ` (at ${where})`
  if (line !== undefined) return ` (line ${String(line)})`
  return ''
}

export class MusicXMLError extends Error {
  readonly path: DocumentPath
  readonly line: number | undefined

  constructor(message: string, location: ErrorLocation = {}) {
    const path = location.path ?? []
    super(message + formatLocation(path, location.line), { cause: location.cause })
    this.name = 'MusicXMLError'
    this.path = path
    this.line = location.line
  }
}
