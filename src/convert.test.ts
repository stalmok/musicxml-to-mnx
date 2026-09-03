// The public entry point, and the one thing a caller can say about the
// conversion. MNX requires the score rendering to be named and MusicXML has
// no name to give it, so the name comes from the caller or from a default.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from './index.js'
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
