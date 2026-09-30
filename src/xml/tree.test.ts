import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from './parse.js'
import { attribute, child, children, descendants, requireAttribute, requireChild } from './tree.js'

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
