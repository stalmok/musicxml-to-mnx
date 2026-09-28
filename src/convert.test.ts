// The public entry point and its options. MNX requires a name for the score
// rendering, and MusicXML has none. A source is text or bytes, so it does not
// carry a document name either.

import { describe, expect, expectTypeOf, test } from 'vitest'
import { convertValid } from '../tests/support/convert.js'
import { InexactFractionError } from './fraction.js'
import { MusicXMLError, convertMusicXML } from './index.js'
import type { ConversionOptions } from './index.js'
import type { WriterOptions } from './write/mnx.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
  '<type>quarter</type></note>'

// The writer emits a scores block only when the source has a layout break.
const SOURCE =
  '<score-partwise><part id="P1">' +
  `<measure number="1"><attributes><divisions>1</divisions></attributes>${NOTE}</measure>` +
  `<measure number="2"><print new-system="yes"/>${NOTE}</measure>` +
  '</part></score-partwise>'

describe('the conversion options', () => {
  test('reach every option the writer takes', () => {
    expectTypeOf<keyof WriterOptions>().toEqualTypeOf<
      Exclude<keyof ConversionOptions, 'documentName'>
    >()
  })
})

describe('the score rendering name', () => {
  test('is the name the caller gives', () => {
    const { mnx, warnings } = convertValid(SOURCE, { scoreName: 'Erlkönig' })

    expect(mnx.scores?.[0]?.name).toBe('Erlkönig')
    expect(warnings).toEqual([])
  })

  test('falls back to a placeholder where the caller names none', () => {
    expect(convertValid(SOURCE).mnx.scores?.[0]?.name).toBe('Score')
    expect(convertValid(SOURCE, {}).mnx.scores?.[0]?.name).toBe('Score')
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
    // The caller passes neither text nor bytes. The document was not refused.
    expect(() => convertMusicXML(undefined as never, { documentName: 'song.mxl' })).toThrow(
      TypeError,
    )
  })

  test('converts to exactly what it would without a name', () => {
    const named = convertValid(SOURCE, { documentName: 'song.mxl' })

    expect(named.mnx).toEqual(convertValid(SOURCE).mnx)
    expect(named.warnings).toEqual([])
  })

  // The refusal is restated to carry the name.
  test('keeps the stack of the reader that refused, not of the naming', () => {
    let thrown
    try {
      convertMusicXML('<score-timewise/>', { documentName: 'song.mxl' })
    } catch (error) {
      thrown = error
    }
    const frames = ((thrown as MusicXMLError).stack ?? '')
      .split('\n')
      .filter((line) => line.trim().startsWith('at '))

    expect(frames[0]).toContain('read/score')
    expect(frames[0]).not.toContain('errors.ts')
  })
})

// Two <divisions> values whose product is past the safe-integer range, so the
// measure's length cannot be exact.
const INEXACT =
  '<score-partwise><part id="P1"><measure number="1">' +
  `<attributes><divisions>100000007</divisions></attributes>${NOTE}` +
  `<attributes><divisions>100000037</divisions></attributes>${NOTE}` +
  '</measure></part></score-partwise>'

describe('arithmetic that cannot be exact', () => {
  function refusal(options?: ConversionOptions): MusicXMLError {
    let thrown
    try {
      convertMusicXML(INEXACT, options)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(MusicXMLError)
    return thrown as MusicXMLError
  }

  test('is a refusal of the document, at no place in it', () => {
    const thrown = refusal()

    expect(thrown.path).toEqual([])
    expect(thrown.detail).toMatch(/^Invalid fraction: /)
    expect(thrown.message).toBe(thrown.detail)
    expect(thrown.cause).toBeInstanceOf(InexactFractionError)
  })

  test('names the document it was found in', () => {
    expect(refusal({ documentName: 'song.mxl' }).document).toBe('song.mxl')
  })
})

describe('a document given as bytes', () => {
  test('keeps the text of a document in its declared ISO-8859-1', () => {
    const text =
      '<?xml version="1.0" encoding="ISO-8859-1"?><score-partwise>' +
      '<part-list><score-part id="P1"><part-name>Été</part-name></score-part></part-list>' +
      '<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
      NOTE.replace('</note>', '<lyric><text>été</text></lyric></note>') +
      '</measure></part></score-partwise>'
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))

    const { mnx, warnings } = convertValid(bytes)

    expect(mnx.parts[0]?.name).toBe('Été')
    expect(JSON.stringify(mnx)).toContain('"été"')
    expect(warnings).toEqual([])
  })
})
