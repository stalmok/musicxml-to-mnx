// A transposing instrument is written at one pitch and sounds at another. MNX
// states the note's sounding pitch and the interval that turns it back into
// the written one; MusicXML states the written pitch and the interval the
// other way round. These cover the arithmetic between the two.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import {
  concertFifths,
  keyFifthsFlipAt,
  soundingPitch,
  writtenFifthsWithFlip,
} from './transposition.js'
import type { TranspositionInterval } from '../model/score.js'
import { WarningCollector } from '../warnings.js'

// The MNX spec's two examples.
const B_FLAT_CLARINET: TranspositionInterval = { staffDistance: 1, halfSteps: 2 }
const PICCOLO: TranspositionInterval = { staffDistance: -7, halfSteps: -12 }

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

// A part avoiding a signature of more than seven sharps or flats writes the
// enharmonic one, which reads back twelve fifths from the score's key. MNX
// states one point for the whole part, measured in the fifths the part would
// write without the flip, and the sign of that point picks the direction.
describe('the point at which a part flips its key signature', () => {
  // The part writes the flatter spelling, so its keys read back twelve fifths
  // below the score's. A B-flat instrument writes two fifths above what it
  // sounds, so the score's five sharps are its seven.
  test('stands at the lowest key the part flips at', () => {
    const keys = [
      { score: 5, part: -7 },
      { score: 7, part: -5 },
    ]

    expect(keyFifthsFlipAt(keys, B_FLAT_CLARINET)).toBe(7)
  })

  // The other direction: the part writes the sharper spelling, so its keys
  // read back twelve fifths above the score's, and the point is the highest
  // it flips at so that every flipped key is below it.
  test('stands at the highest key the part flips at', () => {
    const keys = [
      { score: -5, part: 7 },
      { score: -7, part: 5 },
    ]

    expect(keyFifthsFlipAt(keys, B_FLAT_CLARINET)).toBe(-3)
  })

  // The point is inclusive, so a part flipping where it would write no sharps
  // or flats states zero rather than nothing.
  test('stands at zero where that is the key the part flips at', () => {
    expect(keyFifthsFlipAt([{ score: -2, part: -14 }], B_FLAT_CLARINET)).toBe(0)
  })

  test('says nothing where the part writes what its transposition asks', () => {
    expect(keyFifthsFlipAt([{ score: 2, part: 2 }], B_FLAT_CLARINET)).toBeUndefined()
  })

  // One point stands between the keys the part flips and the keys it leaves
  // alone, so a key it writes both ways cannot be stated.
  test.each([
    [
      'flips at a key it also leaves alone',
      [
        { score: 5, part: -7 },
        { score: 5, part: 5 },
      ],
    ],
    [
      'flips upward at a key it also leaves alone',
      [
        { score: -5, part: 7 },
        { score: -5, part: -5 },
      ],
    ],
  ])('says nothing where the part %s', (_name, keys) => {
    expect(keyFifthsFlipAt(keys, B_FLAT_CLARINET)).toBeUndefined()
  })

  // The direction follows from the sign of the point, so a part flipping down
  // from below zero, or up from zero, is a flip no point states.
  test.each([
    ['down from a key below zero', [{ score: -3, part: -15 }], undefined],
    ['up from a key at zero', [{ score: -2, part: 10 }], undefined],
  ])('says nothing for a part flipping %s', (_name, keys, expected) => {
    expect(keyFifthsFlipAt(keys, B_FLAT_CLARINET)).toBe(expected)
  })

  // Only twelve fifths is the same key spelled the other way; any other
  // distance is a different key, which no point accounts for.
  test('says nothing for a part in a different key outright', () => {
    expect(keyFifthsFlipAt([{ score: -9, part: -4 }], B_FLAT_CLARINET)).toBeUndefined()
  })
})

describe('the key a part writes past its flip point', () => {
  // A point at or above zero takes twelve fifths off from there on; below
  // zero, twelve are added from there down. Either way a key on the other
  // side of the point is written as its transposition asks.
  test.each([
    ['at the point', 5, 7, -5],
    ['past the point', 6, 7, -4],
    ['short of the point', 3, 7, 5],
    ['at a point of zero', 1, 0, -9],
    ['below a point below zero', -9, -7, 5],
    ['above a point below zero', -3, -7, -1],
  ])('writes a key %s', (_name, concert, flipAt, expected) => {
    expect(writtenFifthsWithFlip(concert, B_FLAT_CLARINET, flipAt)).toBe(expected)
  })

  test('writes what its transposition asks where there is no point', () => {
    expect(writtenFifthsWithFlip(5, B_FLAT_CLARINET, undefined)).toBe(7)
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
  const score = readValid(source, warnings)
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

  // Without <chromatic> there is no interval to read.
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
    const { mnx, warnings } = convertValid(inPart(IN_B_FLAT, NOTE))

    expect(mnx.parts[0]?.transposition).toEqual({ interval: { staffDistance: 1, halfSteps: 2 } })
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

  // The two are compared whole, so a pair agreeing on the staff distance but
  // not the half steps is two intervals, and so is the pair the other way
  // round: a major second and a diminished third move the same half steps.
  test.each([
    ['the staff distance', '<diatonic>-1</diatonic><chromatic>-1</chromatic>'],
    ['the half steps', '<diatonic>-2</diatonic><chromatic>-2</chromatic>'],
  ])('reports staves agreeing on %s alone', (_name, second) => {
    const { part, warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
          `<transpose number="2">${second}</transpose>`,
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:per-staff-transposition')
  })

  test('reports a part that changes instrument partway', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
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
    readValid(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>` +
        `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
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

// A score with a transposing part in it writes two key signatures for the
// same music. Converted to the key each sounds in, they agree.
describe('a score holding both a transposing part and a concert one', () => {
  test('states one key, and reports no disagreement', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part-list>' +
        '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
        '<score-part id="P2"><part-name>Clarinet</part-name></score-part>' +
        '</part-list>' +
        '<part id="P1"><measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>0</fifths></key></attributes>${NOTE}</measure></part>` +
        '<part id="P2"><measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>2</fifths></key>${IN_B_FLAT}</attributes>${NOTE}</measure></part>` +
        '</score-partwise>',
      warnings,
    )

    expect(score.globalMeasures[0]?.key).toEqual({ fifths: 0 })
    expect(warnings.list()).toEqual([])
  })
})
