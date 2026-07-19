// The XML layer: parse a document into a small, immutable element tree that
// carries source line numbers, and turn anything malformed into a
// MusicXMLError. Nothing above this layer touches the XML parser directly.

import { parseXml, XmlNode } from '@rgrove/parse-xml'
import type { XmlCdata, XmlElement as SourceElement, XmlText } from '@rgrove/parse-xml'
import { MusicXMLError } from '../errors.js'

/**
 * An element of the source document. Deliberately smaller than the parser's
 * own node type: element children and direct text only, plus the line to
 * report problems against.
 */
export interface XmlElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
  /**
   * Direct text content, exactly as written. Element children contribute
   * nothing to it. Left untrimmed on purpose: a reader that wants a number or
   * a keyword trims it, but lyric text is meaningful to the space, and once
   * this layer has trimmed it there is no way to get it back.
   */
  readonly text: string
  /** 1-based line in the source document. */
  readonly line: number
}

export function parseXmlRoot(source: string): XmlElement {
  try {
    // Two parser defaults do the security work here and must not be relaxed:
    // DTDs are never processed, so an external DTD reference (which every
    // MusicXML file carries) is never fetched; and undefined entities are a
    // parse error rather than something to resolve, which is what closes off
    // entity-expansion and external-entity attacks.
    const document = parseXml(source, { includeOffsets: true })
    const root = document.root
    /* v8 ignore next 3 -- the parser rejects a rootless document before
       returning, so this only guards against that contract changing. */
    if (!root) {
      throw new MusicXMLError('The document has no root element.')
    }
    return convertElement(root, lineStarts(source))
  } catch (cause) {
    // Deliberately broad. Besides the parser's own errors, a document nested
    // tens of thousands of elements deep exhausts the stack inside the parser,
    // a RangeError, which callers should still receive as a rejected
    // document rather than as a crash escaping the library.
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
    } else if (child.type === XmlNode.TYPE_TEXT || child.type === XmlNode.TYPE_CDATA) {
      // Direct text only. The parser's own `text` getter concatenates every
      // descendant's text, which would silently merge a <lyric>'s <syllabic>
      // and <text> children into one string.
      text += (child as XmlText | XmlCdata).text
    }
    // Comments and processing instructions carry no notation.
  }

  return {
    name: element.name,
    // A null prototype: attribute names come from the document, so a
    // spread-into-{} would let one named "constructor" or "toString" be read
    // back as an inherited function where a string was promised.
    attributes: Object.assign(Object.create(null) as Record<string, string>, element.attributes),
    children,
    text,
    line,
  }
}

// The parser's message already names the position; strip its parenthetical so
// MusicXMLError can render the location in this project's own format.
function parseFailure(cause: unknown): MusicXMLError {
  /* v8 ignore next -- everything the parser throws is an Error; the fallback
     only keeps a stray non-Error throw from surfacing as "undefined". */
  const raw = cause instanceof Error ? cause.message : String(cause)
  // The parser's own message names the position; strip its parenthetical, and
  // keep only the summary line, so MusicXMLError renders the location itself.
  const summary = raw
    .split('\n', 1)
    .join('')
    .replace(/\s*\(line \d+, column \d+\)\s*$/, '')
  const line = (cause as { line?: unknown }).line
  return new MusicXMLError(summary, typeof line === 'number' ? { line } : {})
}

// Offsets to line numbers: the parser reports character offsets, but a person
// reading an error wants a line. Computed once per document, then binary
// searched per element.
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
