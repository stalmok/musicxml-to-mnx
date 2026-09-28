// The XML layer: parse a document into a small, immutable element tree that
// carries source line numbers, and turn anything malformed into a
// MusicXMLError. Nothing above this layer touches the XML parser directly.

import { parseXml, XmlNode } from '@rgrove/parse-xml'
import type { XmlElement as SourceElement, XmlText } from '@rgrove/parse-xml'
import { MusicXMLError } from '../errors.js'

/**
 * An element of the source document. Smaller than the parser's node type:
 * element children and direct text only, plus the line to report problems
 * against.
 */
export interface XmlElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
  /**
   * Direct text content as written, without the text of element children.
   * Not trimmed, because spaces in lyric text are significant. A number or a
   * keyword reads `trimmedText`.
   */
  readonly text: string
  /** 1-based line in the source document. */
  readonly line: number
}

export function parseXmlRoot(source: string): XmlElement {
  try {
    // Two parser defaults give the security and must stay: DTDs are not
    // processed, so the external DTD every MusicXML file references is never
    // fetched; and an undefined entity is a parse error, which blocks
    // entity-expansion and external-entity attacks.
    const document = parseXml(source, { includeOffsets: true })
    const root = document.root
    /* v8 ignore next 3 -- the parser rejects a rootless document before
       returning, so this only guards against that contract changing. */
    if (!root) {
      throw new MusicXMLError('The document has no root element.', { path: [] })
    }
    return convertElement(root, lineStarts(source))
  } catch (cause) {
    // Catches everything. Besides the parser's own errors, a document nested
    // tens of thousands of elements deep overflows the stack in the parser, and
    // the caller must get that as a MusicXMLError.
    throw parseFailure(cause)
  }
}

function convertElement(element: SourceElement, starts: readonly number[]): XmlElement {
  const line = lineAt(starts, element.start)

  const children: XmlElement[] = []
  let text = ''
  for (const child of element.children) {
    if (child.type === XmlNode.TYPE_ELEMENT) {
      children.push(convertElement(child as SourceElement, starts))
    } else if (child.type === XmlNode.TYPE_TEXT) {
      // Direct text only. The parser's `text` getter joins all descendant
      // text, which would merge a <lyric>'s <syllabic> and <text> into one
      // string. The parser folds a CDATA section into the text around it.
      text += (child as XmlText).text
    }
    // Comments and processing instructions carry no notation.
  }

  return {
    name: element.name,
    // A null prototype, so a lookup of an attribute the element lacks, such as
    // "constructor" or "toString", gives undefined, not an inherited function.
    attributes: Object.assign(Object.create(null) as Record<string, string>, element.attributes),
    children,
    text,
    line,
  }
}

// The parser's message names the position and then quotes the document
// around it. Keep only the summary line and strip its parenthetical, so
// MusicXMLError can render the location in this project's own format.
function parseFailure(cause: unknown): MusicXMLError {
  /* v8 ignore next -- everything the parser throws is an Error; the fallback
     only keeps a stray non-Error throw from surfacing as "undefined". */
  const raw = cause instanceof Error ? cause.message : String(cause)
  const summary = overflowed(cause)
    ? 'The document is nested too deeply to read.'
    : raw
        .split('\n', 1)
        .join('')
        .replace(/\s*\(line \d+, column \d+\)\s*$/, '')
  const line = (cause as { line?: unknown }).line
  return new MusicXMLError(summary, {
    path: [],
    cause,
    ...(typeof line === 'number' ? { line } : {}),
  })
}

// A stack overflow is a RangeError in V8 and JavaScriptCore, and an
// InternalError in Firefox. Each class has other causes too.
function overflowed(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === 'RangeError' || cause.name === 'InternalError') &&
    /call stack|too much recursion/i.test(cause.message)
  )
}

// The parser reports character offsets. Line starts are computed once per
// document, then binary searched per element.
function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1)
  }
  return starts
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    const start = starts[mid]
    if (start !== undefined && start <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}
