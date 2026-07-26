import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from './parse.js'

describe('parseXmlRoot', () => {
  test('returns the root element', () => {
    const root = parseXmlRoot('<score-partwise version="4.0"></score-partwise>')

    expect(root.name).toBe('score-partwise')
  })

  test('exposes attributes', () => {
    const root = parseXmlRoot('<score-partwise version="4.0"/>')

    expect(root.attributes).toEqual({ version: '4.0' })
  })

  test('exposes element children in document order', () => {
    const root = parseXmlRoot('<part><measure/><measure/><attributes/></part>')

    expect(root.children.map((c) => c.name)).toEqual(['measure', 'measure', 'attributes'])
  })

  test('exposes the text content of a leaf element', () => {
    const root = parseXmlRoot('<pitch><step>C</step></pitch>')

    expect(root.children[0]?.text).toBe('C')
  })

  // Left exactly as written: readers that want a number or a keyword trim it,
  // but lyric text is meaningful to the space and cannot be recovered once
  // this layer has trimmed it.
  test('keeps text exactly as written, whitespace and all', () => {
    const root = parseXmlRoot('<divisions>\n  24\n</divisions>')

    expect(root.text).toBe('\n  24\n')
  })

  test('takes no text from element children', () => {
    const root = parseXmlRoot('<lyric>lead <syllabic>single</syllabic> tail</lyric>')

    expect(root.text).toBe('lead  tail')
  })

  test('does not let a document-supplied attribute name inherit from Object', () => {
    const root = parseXmlRoot('<note constructor="x" __proto__="y"/>')

    expect(root.attributes.constructor).toBe('x')
    expect(Object.getPrototypeOf(root.attributes)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('records the source line of each element', () => {
    const root = parseXmlRoot('<part>\n  <measure/>\n\n  <measure/>\n</part>')

    expect(root.line).toBe(1)
    expect(root.children[0]?.line).toBe(2)
    expect(root.children[1]?.line).toBe(4)
  })

  test('ignores comments and processing instructions', () => {
    const root = parseXmlRoot('<part><!-- a note --><?php ?><measure/></part>')

    expect(root.children.map((c) => c.name)).toEqual(['measure'])
  })

  test('accepts a document with an XML declaration and a DOCTYPE', () => {
    const root = parseXmlRoot(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
        '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
        '<score-partwise version="4.0"/>',
    )

    expect(root.name).toBe('score-partwise')
  })

  test('rejects malformed XML with the line it went wrong on', () => {
    let thrown: unknown
    try {
      parseXmlRoot('<part>\n  <measure>\n</part>')
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).line).toBe(3)
  })

  test('rejects an empty document', () => {
    expect(() => parseXmlRoot('')).toThrow(MusicXMLError)
  })

  // The wrapped error keeps the parser's own error as its cause, so a stack
  // trace still reaches what actually went wrong.
  test('keeps the underlying parser error as the cause', () => {
    let thrown: unknown
    try {
      parseXmlRoot('<part>\n  <measure>\n</part>')
    } catch (e) {
      thrown = e
    }

    expect((thrown as MusicXMLError).cause).toBeInstanceOf(Error)
  })
})

// MusicXML files carry a DOCTYPE pointing at an external DTD over HTTP, and
// arrive from untrusted places (uploads, downloaded corpora). A parser that
// resolved external entities would turn every conversion into a file-read and
// server-side request primitive.
describe('parseXmlRoot resists hostile documents', () => {
  test('does not resolve an external entity referencing a local file', () => {
    const xxe =
      '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n' + '<root>&xxe;</root>'

    // The parser treats the external entity as undefined rather than reading
    // the file, so it rejects the reference outright, naming the entity it
    // would not define. Asserting the rejection names the entity keeps this
    // from passing on a throw that had nothing to do with the entity.
    let thrown: unknown
    try {
      parseXmlRoot(xxe)
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as Error).message).toMatch(/xxe/)
  })

  test('does not fetch an external entity over the network', () => {
    const ssrf =
      '<!DOCTYPE root [<!ENTITY probe SYSTEM "http://127.0.0.1:1/probe">]>\n' +
      '<root>&probe;</root>'

    // Rejected as an undefined entity, never fetched: the same guarantee as
    // the file case, and named the same way so the assertion cannot pass on an
    // unrelated failure.
    let thrown: unknown
    try {
      parseXmlRoot(ssrf)
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as Error).message).toMatch(/probe/)
  })

  test('does not expand nested entities into a memory bomb', () => {
    const billionLaughs =
      '<!DOCTYPE lolz [\n' +
      '<!ENTITY lol "lol">\n' +
      '<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">\n' +
      '<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">\n' +
      '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">\n' +
      '<!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">\n' +
      ']>\n' +
      '<lolz>&lol4;</lolz>'

    let text: string | undefined
    try {
      text = parseXmlRoot(billionLaughs).text
    } catch (e) {
      expect(e).toBeInstanceOf(MusicXMLError)
    }

    expect((text ?? '').length).toBeLessThan(1000)
  })

  // Nesting this deep exhausts the stack inside the parser. What matters is
  // that it surfaces as a rejected document rather than an error escaping the
  // library, so callers need no defensive try/catch of their own.
  test('rejects a document nested deep enough to overflow the stack', () => {
    const depth = 50_000
    const bomb = '<a>'.repeat(depth) + '</a>'.repeat(depth)

    expect(() => parseXmlRoot(bomb)).toThrow(MusicXMLError)
  })

  test('still resolves the five entities XML itself defines', () => {
    const root = parseXmlRoot('<credit-words>Bach &amp; Sons &lt;1750&gt;</credit-words>')

    expect(root.text).toBe('Bach & Sons <1750>')
  })
})
