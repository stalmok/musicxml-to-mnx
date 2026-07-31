// The reader that records what it read. Exercised directly here, because two
// of its guarantees are about the reader itself rather than about any one
// element: that asking twice reports once, and that a nested block's leftovers
// come out with its parent's.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
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
