// The reader that records what it read. Two of its guarantees are about the
// reader itself: asking twice reports once, and a nested block's leftovers
// come out with its parent's.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import { parseXmlRoot } from '../xml/parse.js'
import { attribute, child, readWholeElement } from '../xml/tree.js'
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

  // child() takes the first of a name and is for a name MusicXML allows only
  // one of. A second one is malformed input or a name that needs children().
  // Either way it is a loss.
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

  // Two readers over one element would report its leftovers twice.
  test('hands back the same readers when asked a second time', () => {
    const element = reader('<notations><fermata/></notations>')
    const first = element.blocks('notations')
    const second = element.blocks('notations')

    expect(second[0]).toBe(first[0])
    expect(reported(element)).toEqual(['<fermata> is not converted yet.'])
  })

  test('hands back the same reader for a child asked for both ways', () => {
    const element = reader('<notations><fermata/></notations>')
    const listed = element.blocks('notations')

    expect(element.block(element.element.children[0]!)).toBe(listed[0])
  })

  // A block is asked for by identity where a level walks its children in
  // document order, so a second one of a name has to get its own reader.
  test('reports what each of two blocks of one name passed over', () => {
    const element = reader('<notations><slur/></notations><notations><fermata/></notations>')
    for (const found of element.element.children) element.block(found).children('slur')

    expect(reported(element)).toEqual(['<fermata> is not converted yet.'])
  })
})

// A child read plainly has no reader of its own. What is read below it is
// read with the tree accessors, which keep the record at every depth.
describe('below a child read plainly', () => {
  test('names an element below it that nothing read', () => {
    const element = reader('<pitch><step>C</step><alter>1</alter><octave>4</octave></pitch>')
    const pitch = element.child('pitch')!
    child(pitch, 'step')
    child(pitch, 'octave')

    expect(reported(element)).toEqual(['<alter> is not converted yet.'])
  })

  test('reaches every depth', () => {
    const element = reader(
      '<tuplet type="start"><tuplet-actual><tuplet-number>3</tuplet-number>' +
        '<tuplet-type>eighth</tuplet-type></tuplet-actual></tuplet>',
    )
    const tuplet = element.child('tuplet')!
    attribute(tuplet, 'type')
    child(child(tuplet, 'tuplet-actual')!, 'tuplet-number')

    expect(reported(element)).toEqual(['<tuplet-type> is not converted yet.'])
  })

  test('sweeps the attributes of an element below it', () => {
    const element = reader(
      '<tuplet type="start"><tuplet-actual><tuplet-number color="#FF0000">3</tuplet-number>' +
        '</tuplet-actual></tuplet>',
    )
    const tuplet = element.child('tuplet')!
    attribute(tuplet, 'type')
    child(child(tuplet, 'tuplet-actual')!, 'tuplet-number')

    expect(reported(element)).toEqual([
      'The "color" attribute of a <tuplet-number> is not converted yet.',
    ])
  })

  // An unread element is reported as a whole, so what it holds is not named
  // again.
  test('leaves what an unread element holds to its own report', () => {
    const element = reader(
      '<tuplet><tuplet-actual><tuplet-number>3</tuplet-number></tuplet-actual></tuplet>',
    )
    element.child('tuplet')

    expect(reported(element)).toEqual(['<tuplet-actual> is not converted yet.'])
  })

  test('says nothing below a child read whole', () => {
    const element = reader('<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>')
    readWholeElement(element.child('lyric')!)

    expect(reported(element)).toEqual([])
  })

  test('says nothing more of an element below it that a warning names whole', () => {
    const element = reader('<notations><fermata type="upright">normal</fermata></notations>')
    const warnings = new WarningCollector()
    const fermata = element.child('notations')!.children[0]!
    warnings.addWhole('unsupported:element', 'reported by hand', { measure: 1 }, fermata)
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list().map((warning) => warning.message)).toEqual(['reported by hand'])
  })

  test('says nothing below a child the reader accounts for whole', () => {
    const element = reader('<time-modification><actual-notes>3</actual-notes></time-modification>')
    element.readWhole(element.child('time-modification')!)

    expect(reported(element)).toEqual([])
  })
})

describe('skip', () => {
  test('accounts for a child without anything having read it', () => {
    const element = reader('<tied/>')
    element.skip('tied')

    expect(reported(element)).toEqual([])
  })
})

// The same record, for attributes. Reading one through the tree accessor
// accounts for it, and the sweep names the notation attributes nothing read.
// Presentation attributes (positions, fonts, identity) are passed over.
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

  // An unread child is reported as a whole, so its attributes are not named
  // again.
  test('leaves the attributes of an unread child to its own report', () => {
    const element = reader('<tie type="start"/>')

    expect(reported(element)).toEqual(['<tie> is not converted yet.'])
  })

  test('reports an attribute with no home as a format limit', () => {
    const element = new ElementReader(parseXmlRoot('<dot placement="above"/>'))
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list()[0]?.code).toBe('unrepresentable:attribute')
    expect(warnings.list()[0]?.message).toBe(
      'The "placement" attribute of a <dot> cannot be expressed in MNX.',
    )
  })

  // A report is grouped by what was lost, so an attribute loss has its own
  // field beside the element.
  test('names the attribute as a field beside the element', () => {
    const element = new ElementReader(parseXmlRoot('<measure implicit="yes"/>'))
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list()[0]?.element).toBe('measure')
    expect(warnings.list()[0]?.attribute).toBe('implicit')
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

  // A namespace declaration is not notation.
  test('passes over a namespace declaration', () => {
    const element = new ElementReader(
      parseXmlRoot('<score-partwise xmlns:xlink="http://www.w3.org/1999/xlink"/>'),
    )
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list()).toEqual([])
  })

  test('reports an attribute whose name only ends with xmlns', () => {
    const element = new ElementReader(parseXmlRoot('<measure data-xmlns="yes"/>'))
    const warnings = new WarningCollector()
    element.reportUnread(warnings, { measure: 1 })

    expect(warnings.list().map((w) => w.attribute)).toEqual(['data-xmlns'])
  })
})
