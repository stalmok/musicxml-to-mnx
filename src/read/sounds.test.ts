// The part list's instrument setup. A <score-instrument> names what plays a
// part, and MNX states it in global.sounds, keyed by the source's instrument
// id where MNX can state it. The rest of a <midi-instrument> has no home: the
// schema's sound states midiNumber as a MIDI pitch, backing a percussion kit,
// not as the patch a <midi-program> names. <midi-unpitched> is that pitch and
// is converted; percussion.test.ts holds it to account.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'

const MEASURES =
  '<measure number="1"><attributes><divisions>1</divisions></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>whole</type></note></measure>'

function convert(scorePartContent: string) {
  return convertValid(
    '<score-partwise><part-list><score-part id="P1">' +
      `<part-name>Voice</part-name>${scorePartContent}` +
      '</score-part></part-list>' +
      `<part id="P1">${MEASURES}</part></score-partwise>`,
  )
}

describe('instrument sounds', () => {
  test('writes the instrument name into the sounds', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name>' +
        '</score-instrument>',
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I1': { name: 'Voice' } })
    expect(warnings).toEqual([])
  })

  // MusicXML allows several instruments in one part, as a drum kit is.
  test('writes every instrument the part states', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Soprano</instrument-name>' +
        '</score-instrument>' +
        '<score-instrument id="P1-I2"><instrument-name>Alto</instrument-name>' +
        '</score-instrument>',
    )

    expect(mnx.global.sounds).toEqual({
      'P1-I1': { name: 'Soprano' },
      'P1-I2': { name: 'Alto' },
    })
    expect(warnings).toEqual([])
  })

  // An empty <instrument-name> names nothing, and MNX's sound has an optional
  // name, so the sound is written without one rather than with an empty
  // string.
  test('writes the sound with no name where the name is empty', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name/></score-instrument>',
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I1': {} })
    expect(warnings).toEqual([])
  })

  test('writes no sounds where the list states no instruments', () => {
    const { mnx, warnings } = convert('')

    expect(mnx.global.sounds).toBeUndefined()
    expect(warnings).toEqual([])
  })

  // A <midi-program> names a patch. The schema's sound has only midiNumber,
  // which its docs define as a MIDI pitch backing a percussion kit, so the
  // program has no home and is reported, not miswritten as a pitch.
  test('reports the MIDI program rather than writing it as a pitch', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name>' +
        '</score-instrument>' +
        '<midi-instrument id="P1-I1"><midi-program>53</midi-program></midi-instrument>',
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I1': { name: 'Voice' } })
    expect(warnings.map((warning) => warning.element)).toEqual(['midi-program'])
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:element'])
  })

  test('reports each playback detail a midi-instrument carries', () => {
    const { mnx, warnings } = convert(
      '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name>' +
        '</score-instrument>' +
        '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel>' +
        '<midi-program>53</midi-program><volume>78</volume></midi-instrument>',
    )

    expect(mnx.global.sounds?.['P1-I1']).toEqual({ name: 'Voice' })
    expect(warnings.map((warning) => warning.element).sort()).toEqual([
      'midi-channel',
      'midi-program',
      'volume',
    ])
  })
})
