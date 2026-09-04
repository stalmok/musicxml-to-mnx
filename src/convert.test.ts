// The public entry point, and what a caller can say about the conversion:
// MNX requires the score rendering to be named and MusicXML has no name to
// give it, and a source is text or bytes, so neither name is in the document.

import { describe, expect, test } from 'vitest'
import { MusicXMLError, convertMusicXML } from './index.js'
import { schemaErrors } from '../tests/support/schema.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
  '<type>quarter</type></note>'

// A break is what makes the writer state a score rendering at all: a document
// with nothing to say about its layout writes no scores block to name.
const SOURCE =
  '<score-partwise><part id="P1">' +
  `<measure number="1"><attributes><divisions>1</divisions></attributes>${NOTE}</measure>` +
  `<measure number="2"><print new-system="yes"/>${NOTE}</measure>` +
  '</part></score-partwise>'

describe('the score rendering name', () => {
  test('is the name the caller gives', () => {
    const { mnx, warnings } = convertMusicXML(SOURCE, { scoreName: 'Erlkönig' })

    expect(mnx.scores?.[0]?.name).toBe('Erlkönig')
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('falls back to a placeholder where the caller names none', () => {
    expect(convertMusicXML(SOURCE).mnx.scores?.[0]?.name).toBe('Score')
    expect(convertMusicXML(SOURCE, {}).mnx.scores?.[0]?.name).toBe('Score')
  })
})

describe('the document name', () => {
  test('names the document a reader refusal was found in', () => {
    expect(() => convertMusicXML('<score-timewise/>', { documentName: 'Erlkönig.mxl' })).toThrow(
      /in Erlkönig\.mxl/,
    )
  })

  test('names the document a parse refusal was found in', () => {
    let thrown
    try {
      convertMusicXML('<measure', { documentName: 'broken.musicxml' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).document).toBe('broken.musicxml')
  })

  test('leaves a refusal unnamed where the caller names nothing', () => {
    let thrown
    try {
      convertMusicXML('<score-timewise/>')
    } catch (error) {
      thrown = error
    }

    expect((thrown as MusicXMLError).document).toBeUndefined()
    expect((thrown as MusicXMLError).message).not.toContain('(in ')
  })

  test('does not dress a crash up as a refusal of the document', () => {
    // A caller passing neither text nor bytes: the failure is theirs, and
    // relabelling it would say the document was refused when it was not.
    expect(() => convertMusicXML(undefined as never, { documentName: 'song.mxl' })).toThrow(
      TypeError,
    )
  })

  test('says nothing about the document in a conversion that succeeds', () => {
    const { mnx, warnings } = convertMusicXML(SOURCE, { documentName: 'song.mxl' })

    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
