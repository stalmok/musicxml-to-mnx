import { describe, expect, test } from 'vitest'
import { MusicXMLError, formatPath } from './errors.js'

describe('formatPath', () => {
  test('joins path segments with a readable separator', () => {
    expect(formatPath(['part P1', 'measure 3', 'note'])).toBe('part P1 > measure 3 > note')
  })

  test('is empty for an empty path', () => {
    expect(formatPath([])).toBe('')
  })
})

describe('MusicXMLError', () => {
  test('reports where in the document the problem was found', () => {
    const error = new MusicXMLError('Missing <divisions>', {
      path: ['part P1', 'measure 1'],
      line: 42,
    })

    expect(error.message).toBe('Missing <divisions> (at part P1 > measure 1, line 42)')
  })

  test('reports the line alone when there is no path', () => {
    const error = new MusicXMLError('Malformed XML', { line: 7 })

    expect(error.message).toBe('Malformed XML (line 7)')
  })

  test('reports the path alone when there is no line', () => {
    const error = new MusicXMLError('Unsupported document', { path: ['score-timewise'] })

    expect(error.message).toBe('Unsupported document (at score-timewise)')
  })

  test('leaves the message bare when there is no location at all', () => {
    expect(new MusicXMLError('Empty document').message).toBe('Empty document')
  })

  test('exposes the location for programmatic handling', () => {
    const error = new MusicXMLError('Bad note', { path: ['measure 2'], line: 9 })

    expect(error.path).toEqual(['measure 2'])
    expect(error.line).toBe(9)
  })

  test('is a catchable Error subclass with its own name', () => {
    const error = new MusicXMLError('Bad note')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('MusicXMLError')
  })
})
