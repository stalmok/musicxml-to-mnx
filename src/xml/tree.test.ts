import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from './parse.js'
import {
  attribute,
  child,
  children,
  descendants,
  peeking,
  readAttributeNames,
  readWholeElement,
  requireAttribute,
  requireChild,
  wasRead,
} from './tree.js'

const measure = parseXmlRoot(
  '<measure number="1">\n' +
    '  <attributes><divisions>4</divisions></attributes>\n' +
    '  <note><pitch><step>C</step></pitch></note>\n' +
    '  <note><rest/></note>\n' +
    '</measure>',
)

describe('child', () => {
  test('finds the first child element with the given name', () => {
    expect(child(measure, 'note')?.children[0]?.name).toBe('pitch')
  })

  test('is undefined when there is no such child', () => {
    expect(child(measure, 'barline')).toBeUndefined()
  })
})

describe('descendants', () => {
  test('walks every element below, each before what it holds', () => {
    expect([...descendants(measure)].map((found) => found.name)).toEqual([
      'attributes',
      'divisions',
      'note',
      'pitch',
      'step',
      'note',
      'rest',
    ])
  })
})

describe('children', () => {
  test('finds every child element with the given name', () => {
    expect(children(measure, 'note')).toHaveLength(2)
  })

  test('is empty when there is no such child', () => {
    expect(children(measure, 'barline')).toEqual([])
  })

  test('does not reach past direct children', () => {
    expect(children(measure, 'pitch')).toEqual([])
  })
})

describe('requireChild', () => {
  test('returns the child when it is there', () => {
    expect(requireChild(measure, 'attributes', []).name).toBe('attributes')
  })

  test('reports the missing element, where it was expected, and the line', () => {
    let thrown: unknown
    try {
      requireChild(measure, 'barline', ['part P1'])
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toBe(
      '<measure> is missing a <barline> child. (at part P1 > measure, line 1)',
    )
  })
})

describe('attribute', () => {
  test('reads an attribute', () => {
    expect(attribute(measure, 'number')).toBe('1')
  })

  test('is undefined when the attribute is absent', () => {
    expect(attribute(measure, 'implicit')).toBeUndefined()
  })
})

describe('requireAttribute', () => {
  test('returns the value when it is there', () => {
    expect(requireAttribute(measure, 'number', [])).toBe('1')
  })

  test('reports the missing attribute, where it was expected, and the line', () => {
    let thrown: unknown
    try {
      requireAttribute(measure, 'width', ['part P1'])
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toBe(
      '<measure> is missing a "width" attribute. (at part P1 > measure, line 1)',
    )
  })
})

// Each test parses its own tree, because the record is kept per element.
describe('the read record', () => {
  const note = () => parseXmlRoot('<note><pitch><step>C</step></pitch><rest/><dot/><dot/></note>')

  test('records what child(), children() and requireChild() find', () => {
    const element = note()
    const found = [
      child(element, 'pitch')!,
      ...children(element, 'dot'),
      requireChild(element, 'rest', []),
    ]

    expect(found.map(wasRead)).toEqual([true, true, true, true])
  })

  test('records nothing for a walk over the tree', () => {
    const element = note()
    const walked = [...descendants(element), ...element.children]

    expect(walked.some(wasRead)).toBe(false)
  })

  test('records only the element found, not what it holds', () => {
    const element = note()
    const pitch = child(element, 'pitch')

    expect(pitch?.children.some(wasRead)).toBe(false)
  })

  test('records an element read whole, its attributes and everything below it', () => {
    const element = parseXmlRoot(
      '<lyric number="1"><syllabic>single</syllabic><text font-size="9">la</text></lyric>',
    )
    readWholeElement(element)

    expect([element, ...descendants(element)].every(wasRead)).toBe(true)
    expect([...(readAttributeNames(element) ?? [])]).toEqual(['number'])
    expect([...(readAttributeNames(element.children[1]!) ?? [])]).toEqual(['font-size'])
  })
})

describe('peeking', () => {
  const note = () => parseXmlRoot('<note><rest measure="yes"/><voice>1</voice></note>')

  test('records nothing a read looking ahead finds', () => {
    const element = note()
    const rest = peeking(() => {
      const found = child(element, 'rest')!
      attribute(found, 'measure')
      children(element, 'voice')
      return found
    })

    expect(element.children.some(wasRead)).toBe(false)
    expect(readAttributeNames(rest)).toBeUndefined()
  })

  test('records again once the read returns, and once it throws', () => {
    const element = note()
    peeking(() => child(element, 'rest'))
    expect(() =>
      peeking(() => {
        throw new Error('stop')
      }),
    ).toThrow('stop')
    const found = [child(element, 'rest')!, child(element, 'voice')!]

    expect(found.map(wasRead)).toEqual([true, true])
  })

  test('keeps not recording after a read inside it returns', () => {
    const element = note()
    peeking(() => {
      peeking(() => child(element, 'rest'))
      child(element, 'voice')
    })

    expect(element.children.some(wasRead)).toBe(false)
  })
})
