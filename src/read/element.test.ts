// The reader that records what it read. Exercised directly here, because two
// of its guarantees are about the reader itself rather than about any one
// element: that asking twice reports once, and that a nested block's leftovers
// come out with its parent's.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { attribute } from '../xml/tree.js'
import { ElementReader } from './element.js'

function reader(body: string): ElementReader {
  return new ElementReader(parseXmlRoot(`<note>${body}</note>`))
}

function reported(element: ElementReader): string[] {
  const warnings = new WarningCollector()
  element.reportUnread(warnings, { measure: 1 })
  return warnings.list().map((warning) => warning.message)
}

describe('reportUnread', () => {
  test('names every child the reader never asked for', () => {
    const element = reader('<pitch/><lyric/><stem/>')
    element.child('pitch')

    expect(reported(element)).toEqual([
      '<lyric> is not converted yet.',
      '<stem> is not converted yet.',
    ])
  })

  // child() takes the first of a name and is meant for a name MusicXML allows
  // only one of. A second one is either malformed input or a name that should
  // have been read with children(); either way it is a loss, not something to
  // pass over on the strength of the first having been read.
  test('reports a repeat of a child that child() took only the first of', () => {
    const element = reader('<pitch/><pitch/>')
    element.child('pitch')

    expect(reported(element)).toEqual(['<pitch> is not converted yet.'])
  })

  test('says nothing about a child that was asked for but is absent', () => {
    const element = reader('')
    element.child('pitch')

    expect(reported(element)).toEqual([])
  })

  test('carries the measure it was read in', () => {
    const element = reader('<lyric/>')
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { part: 'P1', measure: 4 })

    expect(warnings.list()[0]?.context).toEqual({ part: 'P1', measure: 4, line: 1 })
  })
})

describe('blocks', () => {
  test('reports what a nested block passed over, along with its parent', () => {
    const element = reader('<notations><slur/><fermata/></notations>')
    for (const block of element.blocks('notations')) block.children('slur')

    expect(reported(element)).toEqual(['<fermata> is not converted yet.'])
  })

  // Two readers over one element would report its leftovers twice, which would
  // make the loss report depend on how many times a caller happened to ask.
  test('hands back the same readers when asked a second time', () => {
    const element = reader('<notations><fermata/></notations>')
    const first = element.blocks('notations')
    const second = element.blocks('notations')

    expect(second).toBe(first)
    expect(reported(element)).toEqual(['<fermata> is not converted yet.'])
  })
})

describe('skip', () => {
  test('accounts for a child without anything having read it', () => {
    const element = reader('<tied/>')
    element.skip('tied')

    expect(reported(element)).toEqual([])
  })
})

// The same record, for attributes: reading one through the tree accessor is
// what accounts for it, and the sweep names the notation-bearing ones nothing
// read. Presentation attributes (positions, fonts, identity) say how things
// are drawn rather than what they are, and are passed over without a word.
describe('the attribute sweep', () => {
  // implicit="yes" excludes a pickup or courtesy measure from the numbering,
  // and MNX's measure number is a plain integer override with no way to
  // state a measure unnumbered.
  test('names an attribute nothing read', () => {
    const element = new ElementReader(parseXmlRoot('<measure number="1" implicit="yes"/>'))
    attribute(element.element, 'number')

    expect(reported(element)).toEqual([
      'The "implicit" attribute of a <measure> cannot be expressed in MNX.',
    ])
  })

  test('says nothing about an attribute something read', () => {
    const element = new ElementReader(parseXmlRoot('<measure implicit="yes"/>'))
    attribute(element.element, 'implicit')

    expect(reported(element)).toEqual([])
  })

  test('passes over presentation attributes without a word', () => {
    const element = new ElementReader(
      parseXmlRoot(
        '<note default-x="12.3" relative-y="-5" font-family="Edwin" font-size="10" id="n1"/>',
      ),
    )

    expect(reported(element)).toEqual([])
  })

  test('sweeps the attributes of a child the reader took', () => {
    const element = reader('<tie type="start" orientation="over"/>')
    const tie = element.child('tie')
    if (tie) attribute(tie, 'type')

    expect(reported(element)).toEqual([
      'The "orientation" attribute of a <tie> is not converted yet.',
    ])
  })

  // An unread child is reported wholesale; naming its attributes on top
  // would report the same loss twice.
  test('leaves the attributes of an unread child to its own report', () => {
    const element = reader('<tie type="start"/>')

    expect(reported(element)).toEqual(['<tie> is not converted yet.'])
  })

  // An attribute with no schema definition to hold it is a format limit,
  // like an element with no home, and reports as one.
  test('reports an attribute with no home as a format limit', () => {
    const element = new ElementReader(parseXmlRoot('<dot placement="above"/>'))
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list()[0]?.code).toBe('unrepresentable:attribute')
    expect(warnings.list()[0]?.message).toBe(
      'The "placement" attribute of a <dot> cannot be expressed in MNX.',
    )
  })

  test('sweeps a nested block along with its parent', () => {
    const element = reader('<notations><slur number="1" placement="above"/></notations>')
    for (const block of element.blocks('notations')) {
      const slur = block.child('slur')
      if (slur) attribute(slur, 'number')
    }

    expect(reported(element)).toEqual([
      'The "placement" attribute of a <slur> is not converted yet.',
    ])
  })
})
