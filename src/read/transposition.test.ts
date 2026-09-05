// A transposing instrument is written at one pitch and sounds at another. MNX
// states the note's sounding pitch and the interval that turns it back into
// the written one; MusicXML states the written pitch and the interval the
// other way round. These cover the arithmetic between the two.

import { describe, expect, test } from 'vitest'
import { concertFifths, soundingPitch } from './transposition.js'
import type { Transposition } from '../model/score.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

// The spec's own two examples, as MNX states them.
const B_FLAT_CLARINET: Transposition = { staffDistance: 1, halfSteps: 2 }
const PICCOLO: Transposition = { staffDistance: -7, halfSteps: -12 }

describe('the pitch a written note sounds', () => {
  test('sounds a B-flat clarinet a major second below what it reads', () => {
    expect(soundingPitch({ step: 'C', octave: 4, alter: 0 }, B_FLAT_CLARINET)).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
  })

  test('sounds a piccolo an octave above what it reads', () => {
    expect(soundingPitch({ step: 'C', octave: 4, alter: 0 }, PICCOLO)).toEqual({
      step: 'C',
      octave: 5,
      alter: 0,
    })
  })

  // The written spelling settles the sounding one: a written D sounds C, and
  // a written E-flat sounds D-flat, not C-sharp.
  test('keeps the spelling the written interval gives', () => {
    expect(soundingPitch({ step: 'E', octave: 4, alter: -1 }, B_FLAT_CLARINET)).toEqual({
      step: 'D',
      octave: 4,
      alter: -1,
    })
  })

  // A written F double-sharp is a major second above E-sharp, not above E, so
  // the alteration the sounding note carries is not the written one.
  test('respells a double sharp as the interval gives', () => {
    expect(soundingPitch({ step: 'F', octave: 4, alter: 2 }, B_FLAT_CLARINET)).toEqual({
      step: 'E',
      octave: 4,
      alter: 1,
    })
  })

  // An interval crossing the octave boundary counts the octave down with it.
  test('counts the octave down where the interval crosses it', () => {
    expect(soundingPitch({ step: 'C', octave: 5, alter: 0 }, B_FLAT_CLARINET)).toEqual({
      step: 'B',
      octave: 4,
      alter: -1,
    })
  })

  // An E-flat instrument reads a major sixth above what it sounds.
  test('sounds an E-flat instrument a major sixth below what it reads', () => {
    expect(
      soundingPitch({ step: 'A', octave: 4, alter: 0 }, { staffDistance: 5, halfSteps: 9 }),
    ).toEqual({ step: 'C', octave: 4, alter: 0 })
  })

  test('leaves a part at concert pitch alone', () => {
    const pitch = { step: 'F' as const, octave: 3, alter: 1 }

    expect(soundingPitch(pitch, { staffDistance: 0, halfSteps: 0 })).toEqual(pitch)
  })
})

describe('the key a written signature sounds in', () => {
  // A B-flat clarinet reads two sharps more than the music sounds in, so a
  // part written in D sounds in C.
  test('takes two sharps off a B-flat instrument', () => {
    expect(concertFifths(2, B_FLAT_CLARINET)).toBe(0)
  })

  test('leaves an octave transposition in the same key', () => {
    expect(concertFifths(3, PICCOLO)).toBe(3)
  })

  test('adds three sharps for an E-flat instrument reading a major sixth up', () => {
    expect(concertFifths(0, { staffDistance: 5, halfSteps: 9 })).toBe(-3)
  })

  test('leaves a part at concert pitch alone', () => {
    expect(concertFifths(-4, { staffDistance: 0, halfSteps: 0 })).toBe(-4)
  })
})

// A B-flat clarinet, as MusicXML states it: written a major second above what
// it sounds, so the interval to the sounding pitch is down a major second.
const IN_B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'

function inPart(attributes: string, body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes><divisions>4</divisions>${attributes}</attributes>${body}` +
    '</measure></part></score-partwise>'
  )
}

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch>' +
  '<duration>4</duration><type>quarter</type></note>'

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  return { score, part: score.parts[0], warnings: warnings.list() }
}

describe('a part written for a transposing instrument', () => {
  test('states the interval back to the written pitch', () => {
    const { part } = read(inPart(IN_B_FLAT, NOTE))

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
  })

  test('writes what the instrument sounds, not what it reads', () => {
    const { part } = read(inPart(IN_B_FLAT, NOTE))
    const item = part?.measures[0]?.sequences[0]?.content[0]

    expect(item?.kind === 'event' && item.notes[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
  })

  // <chromatic> is the only one MusicXML requires. A part stating it alone
  // moves the same number of staff steps as it does letters, which is none.
  test('reads a transpose stating only its half steps', () => {
    const { part } = read(inPart('<transpose><chromatic>-2</chromatic></transpose>', NOTE))

    expect(part?.transposition).toEqual({ staffDistance: 0, halfSteps: 2 })
  })

  // MusicXML requires <chromatic>, and there is nothing to read the interval
  // from without it.
  test('refuses a transpose stating no half steps', () => {
    expect(() => read(inPart('<transpose><diatonic>-1</diatonic></transpose>', NOTE))).toThrow(
      /chromatic/,
    )
  })

  test('counts an octave change into the interval', () => {
    const { part } = read(
      inPart(
        '<transpose><diatonic>0</diatonic><chromatic>0</chromatic>' +
          '<octave-change>1</octave-change></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: -7, halfSteps: -12 })
  })

  test('states the key the music sounds in, not the one the part reads', () => {
    const { score } = read(inPart(`${IN_B_FLAT}<key><fifths>2</fifths></key>`, NOTE))

    expect(score.globalMeasures[0]?.key).toEqual({ fifths: 0 })
  })

  test('leaves a part at concert pitch untransposed', () => {
    const { part } = read(
      inPart('<transpose><diatonic>0</diatonic><chromatic>0</chromatic></transpose>', NOTE),
    )
    const item = part?.measures[0]?.sequences[0]?.content[0]

    expect(part?.transposition).toEqual({ staffDistance: 0, halfSteps: 0 })
    expect(item?.kind === 'event' && item.notes[0]?.pitch.step).toBe('C')
  })

  test('converts to MNX the schema accepts', () => {
    const { mnx, warnings } = convertMusicXML(inPart(IN_B_FLAT, NOTE))

    expect(mnx.parts[0]?.transposition).toEqual({ interval: { staffDistance: 1, halfSteps: 2 } })
    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings).toEqual([])
  })
})

// MusicXML writes one <transpose> per staff and lets a part change instrument
// partway. MNX states one transposition for the part, so the first is the one
// written out and the rest are reported.
describe('a part stating more than one transposition', () => {
  test('reports staves transposed by different intervals', () => {
    const { part, warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
          '<transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    // The staff each names has no home either, since MNX states one for the
    // whole part, so both "number" attributes are reported as well.
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:per-staff-transposition',
      'unsupported:attribute',
      'unsupported:attribute',
    ])
    expect(warnings[0]?.element).toBe('transpose')
  })

  test('reports a part that changes instrument partway', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1">' +
          `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
          `${NOTE}</measure>` +
          '<measure number="2"><attributes>' +
          '<transpose><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
          `</attributes>${NOTE}</measure>` +
          '</part></score-partwise>',
      ),
      warnings,
    )
    const second = score.parts[0]?.measures[1]?.sequences[0]?.content[0]

    // The part states the first instrument, and the second measure sounds as
    // the instrument playing it does: a written C sounds an A.
    expect(score.parts[0]?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(second?.kind === 'event' && second.notes[0]?.pitch).toEqual({
      step: 'A',
      octave: 3,
      alter: 0,
    })
    expect(warnings.list().map((one) => one.code)).toEqual(['unrepresentable:transposition-change'])
  })

  // A restatement of the same interval is not a change.
  test('says nothing where a later measure restates the same interval', () => {
    const warnings = new WarningCollector()
    readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1">' +
          `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
          `${NOTE}</measure>` +
          `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
          '</part></score-partwise>',
      ),
      warnings,
    )

    expect(warnings.list()).toEqual([])
  })

  // <double> sounds a further octave away, which one interval cannot hold
  // beside the transposition itself.
  test('reports a doubled transposition', () => {
    const { warnings } = read(
      inPart(
        '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic><double/></transpose>',
        NOTE,
      ),
    )

    expect(warnings.map((w) => w.element)).toEqual(['double'])
  })
})

// A score with a transposing part in it writes two different key signatures
// for the same music, and used to report them as parts in different keys.
// Converted to the key each sounds in, they agree.
describe('a score holding both a transposing part and a concert one', () => {
  test('states one key, and reports no disagreement', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part-list>' +
          '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
          '<score-part id="P2"><part-name>Clarinet</part-name></score-part>' +
          '</part-list>' +
          '<part id="P1"><measure number="1"><attributes><divisions>4</divisions>' +
          `<key><fifths>0</fifths></key></attributes>${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1"><attributes><divisions>4</divisions>' +
          `<key><fifths>2</fifths></key>${IN_B_FLAT}</attributes>${NOTE}</measure></part>` +
          '</score-partwise>',
      ),
      warnings,
    )

    expect(score.globalMeasures[0]?.key).toEqual({ fifths: 0 })
    expect(warnings.list()).toEqual([])
  })
})
