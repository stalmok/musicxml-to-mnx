// The part list's instrument setup. A <score-instrument> names what plays a
// part and a <midi-instrument> says how to synthesize it. MNX states both in
// global.sounds, keyed here by the source's instrument id: the drawn name,
// and the MIDI program as midiNumber.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const MEASURES =
  '<measure number="1"><attributes><divisions>1</divisions></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>whole</type></note></measure>'

function convert(scorePartContent: string) {
  return convertMusicXML(
    '<score-partwise><part-list><score-part id="P1">' +
      `<part-name>Voice</part-name>${scorePartContent}` +
      '</score-part></part-list>' +
      `<part id="P1">${MEASURES}</part></score-partwise>`,
  )
}

describe('instrument sounds', () => {
  test('writes an instrument name and program into the sounds', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name>' +
        '</score-instrument>' +
        '<midi-instrument id="P1-I1"><midi-program>53</midi-program></midi-instrument>',
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I1': { name: 'Voice', midiNumber: 53 } })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes a name alone where no program is stated', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Oboe</instrument-name>' +
        '</score-instrument>',
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I1': { name: 'Oboe' } })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no sounds where the list states no instruments', () => {
    const { mnx, warnings } = convert('')

    expect(mnx.global.sounds).toBeUndefined()
    expect(warnings).toEqual([])
  })

  // The rest of what a <midi-instrument> carries is playback MNX has no home
  // for, reported like any other.
  test('reports the playback details it does not carry', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name>' +
        '</score-instrument>' +
        '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel>' +
        '<midi-program>53</midi-program><volume>78</volume></midi-instrument>',
    )

    expect(mnx.global.sounds?.['P1-I1']).toEqual({ name: 'Voice', midiNumber: 53 })
    expect(warnings.map((warning) => warning.element).sort()).toEqual(['midi-channel', 'volume'])
  })

  test('refuses a program outside the MIDI range', () => {
    expect(() =>
      convert('<midi-instrument id="P1-I1"><midi-program>129</midi-program></midi-instrument>'),
    ).toThrow(MusicXMLError)
  })
})
