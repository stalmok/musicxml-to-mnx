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
    const error = new MusicXMLError('Malformed XML', { path: [], line: 7 })

    expect(error.message).toBe('Malformed XML (line 7)')
  })

  test('reports the path alone when there is no line', () => {
    const error = new MusicXMLError('Unsupported document', { path: ['score-timewise'] })

    expect(error.message).toBe('Unsupported document (at score-timewise)')
  })

  test('leaves the message bare when the path is empty and there is no line', () => {
    expect(new MusicXMLError('Empty document', { path: [] }).message).toBe('Empty document')
  })

  test('names the document it was found in when one is given', () => {
    const error = new MusicXMLError('Missing <divisions>', {
      path: ['part P1', 'measure 1'],
      line: 42,
      document: 'song.mxl',
    })

    expect(error.message).toBe('Missing <divisions> (in song.mxl, at part P1 > measure 1, line 42)')
    expect(error.document).toBe('song.mxl')
  })

  test('names the document alone when there is no path and no line', () => {
    const error = new MusicXMLError('Empty document', { path: [], document: 'song.mxl' })

    expect(error.message).toBe('Empty document (in song.mxl)')
  })

  test('exposes the location for programmatic handling', () => {
    const error = new MusicXMLError('Bad note', { path: ['measure 2'], line: 9 })

    expect(error.path).toEqual(['measure 2'])
    expect(error.line).toBe(9)
    expect(error.document).toBeUndefined()
  })

  test('keeps the message without the location, for grouping refusals', () => {
    const error = new MusicXMLError('Bad note', { path: ['measure 2'], line: 9 })

    expect(error.detail).toBe('Bad note')
  })

  describe('inDocument', () => {
    test('restates the same refusal against a document', () => {
      const cause = new Error('underlying')
      const named = new MusicXMLError('Bad note', {
        path: ['measure 2'],
        line: 9,
        cause,
      }).inDocument('song.mxl')

      expect(named.message).toBe('Bad note (in song.mxl, at measure 2, line 9)')
      expect(named.detail).toBe('Bad note')
      expect(named.path).toEqual(['measure 2'])
      expect(named.line).toBe(9)
      expect(named.cause).toBe(cause)
    })

    test('replaces a document already named', () => {
      const named = new MusicXMLError('Bad note', {
        path: [],
        document: 'first.mxl',
      }).inDocument('second.mxl')

      expect(named.message).toBe('Bad note (in second.mxl)')
    })
  })

  test('is a catchable Error subclass with its own name', () => {
    const error = new MusicXMLError('Bad note', { path: [] })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('MusicXMLError')
  })
})
