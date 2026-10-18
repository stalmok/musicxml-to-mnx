// A transposing instrument is written at one pitch and sounds at another. MNX
// states the note's sounding pitch and the interval that turns it back into
// the written one; MusicXML states the written pitch and the interval the
// other way round. These cover the arithmetic between the two.

import { notesOf, readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import {
  concertFifths,
  keyFifthsFlipAt,
  soundingPitch,
  writtenFifthsWithFlip,
} from './transposition.js'
import type { TranspositionInterval } from '../model/score.js'
import { WarningCollector } from './collector.js'

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

const REST = '<note><rest/><duration>4</duration><type>quarter</type></note>'

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

    expect(item?.kind === 'event' && notesOf(item)[0]?.pitch).toEqual({
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
    expect(item?.kind === 'event' && notesOf(item)[0]?.pitch.step).toBe('C')
  })

  test('converts to MNX the schema accepts', () => {
    const { mnx, warnings } = convertValid(inPart(IN_B_FLAT, NOTE))

    expect(mnx.parts[0]?.transposition).toEqual({ interval: { staffDistance: 1, halfSteps: 2 } })
    expect(warnings).toEqual([])
  })
})

// MusicXML writes one <transpose> per staff and lets a part change instrument
// partway. MNX states one transposition for the part, so the one in force at
// the part's first pitched note is written out and the rest are reported.
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
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-transposition'])
    expect(warnings[0]?.element).toBe('transpose')
  })

  test('says nothing where every staff names the same interval', () => {
    const { part, warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
          '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings).toEqual([])
  })

  test('takes the number on a one-staff part as the whole part', () => {
    const { part, warnings } = read(
      inPart(
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings).toEqual([])
  })

  // A staff no <transpose> names sounds as written.
  test('reports a staff left at concert pitch beside a transposed one', () => {
    const { part, warnings } = read(
      inPart(
        '<staves>2</staves>\n' +
          '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => [w.code, w.element, w.context.line])).toEqual([
      ['unrepresentable:per-staff-transposition', 'transpose', 2],
    ])
  })

  // A source can give each staff its own <transpose> in a separate
  // <attributes>, so the staves are compared once the measure is read.
  test('says nothing where the staves are given the same interval in two <attributes>', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '</attributes>' +
        '<attributes>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '</attributes>' +
        NOTE +
        '</measure></part></score-partwise>',
    )

    expect(warnings).toEqual([])
  })

  // Together, the <attributes> before the part's first note state where it
  // starts, however many blocks they take. The staves here are in B-flat
  // and F, and the first staff, in F, is the one followed.
  describe('given its staves in two <attributes> before its first note', () => {
    const KEY = '<key><fifths>0</fifths></key>'
    const SECOND_IN_B_FLAT =
      '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const FIRST_IN_F =
      '<transpose number="1"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>'
    const IN_F = { staffDistance: 4, halfSteps: 7 }
    const inMeasure = (body: string) =>
      '<score-partwise><part id="P1"><measure number="1">' +
      `<attributes><divisions>4</divisions><staves>2</staves></attributes>${body}` +
      '</measure></part></score-partwise>'

    test.each([
      ['in one block', `<attributes>${KEY}${SECOND_IN_B_FLAT}${FIRST_IN_F}</attributes>`],
      [
        'with the key first',
        `<attributes>${KEY}${SECOND_IN_B_FLAT}</attributes>` +
          `<attributes>${FIRST_IN_F}</attributes>`,
      ],
      [
        'with the key last',
        `<attributes>${SECOND_IN_B_FLAT}</attributes>` +
          `<attributes>${KEY}${FIRST_IN_F}</attributes>`,
      ],
    ])('takes the first staff, and converts the key with it, %s', (_name, attributes) => {
      const { score, part, warnings } = read(inMeasure(attributes + NOTE))
      const first = part?.measures[0]?.sequences[0]?.content[0]

      expect(part?.transposition).toEqual(IN_F)
      expect(first?.kind === 'event' && notesOf(first)[0]?.pitch).toEqual({
        step: 'F',
        octave: 3,
        alter: 0,
      })
      expect(score.globalMeasures[0]?.key).toEqual({ fifths: -1 })
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-transposition'])
    })

    // The key stays with the transposition in force at the first note.
    test('reports a change of instrument after the first note', () => {
      const { score, part, warnings } = read(
        inMeasure(
          `<attributes>${KEY}${SECOND_IN_B_FLAT}</attributes>${NOTE}` +
            `<attributes>${FIRST_IN_F}</attributes>${NOTE}`,
        ),
      )

      expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
      expect(score.globalMeasures[0]?.key).toEqual({ fifths: -2 })
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:per-staff-transposition',
        'unrepresentable:transposition-change',
      ])
    })

    test('agrees with a concert part on the key it sounds in', () => {
      const { score, warnings } = read(
        '<score-partwise><part-list>' +
          '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
          '<score-part id="P2"><part-name>Horn</part-name></score-part>' +
          '</part-list>' +
          '<part id="P1"><measure number="1"><attributes><divisions>4</divisions>' +
          `<key><fifths>-1</fifths></key></attributes>${NOTE}</measure></part>` +
          '<part id="P2"><measure number="1">' +
          `<attributes><divisions>4</divisions><staves>2</staves>${KEY}${SECOND_IN_B_FLAT}` +
          `</attributes><attributes>${FIRST_IN_F}</attributes>${NOTE}</measure></part>` +
          '</score-partwise>',
      )

      expect(score.globalMeasures[0]?.key).toEqual({ fifths: -1 })
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-transposition'])
    })
  })

  const IN_F = '<transpose><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>'

  // A rest is placed by the clef, not transposed, so it fixes nothing.
  test('takes the transposition of the first note after a rest', () => {
    const { part, warnings } = read(
      inPart(IN_B_FLAT, `${REST}<attributes>${IN_F}</attributes>${NOTE}`),
    )

    expect(part?.transposition).toEqual({ staffDistance: 4, halfSteps: 7 })
    expect(warnings).toEqual([])
  })

  // An unpitched note is placed by <display-step>, not transposed, so it fixes nothing.
  test('takes the transposition of the first note after an unpitched note', () => {
    const { part, warnings } = read(
      inPart(
        `<clef><sign>percussion</sign></clef>${IN_B_FLAT}`,
        '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave>' +
          '</unpitched><duration>4</duration><type>quarter</type></note>' +
          `<attributes>${IN_F}</attributes>${NOTE}`,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 4, halfSteps: 7 })
    expect(warnings).toEqual([])
  })

  // An octave transposition writes the key a part at concert pitch writes.
  test('takes an octave transposition after rests under a key at concert pitch', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>2</fifths></key></attributes>${REST}</measure>` +
        '<measure number="2"><attributes><transpose><diatonic>0</diatonic>' +
        '<chromatic>0</chromatic><octave-change>2</octave-change></transpose></attributes>' +
        `${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: -14, halfSteps: -24 })
    expect(warnings).toEqual([])
  })

  test('reports a key at concert pitch before rests and a transposed first note', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>0</fifths></key></attributes>${REST}</measure>` +
        `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 'key', 1],
    ])
  })

  test('reports the first of two keys at concert pitch before a transposed first note', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>0</fifths></key></attributes>${REST}</measure>` +
        `<measure number="2"><attributes><key><fifths>1</fifths></key></attributes>${REST}</measure>` +
        `<measure number="3"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 'key', 1],
    ])
  })

  // A non-traditional key converts to no key, so no transposition writes it.
  test('says nothing of a key MNX cannot state before a transposed first note', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        '<key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>' +
        `${REST}</measure>` +
        `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => w.code)).not.toContain('unrepresentable:transposition-change')
  })

  test('keeps the transposition of a part of rests with no key', () => {
    const { part, warnings } = read(inPart(IN_B_FLAT, REST))

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings).toEqual([])
  })

  test('takes the transposition of the first key in a part of rests', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>2</fifths></key>${IN_B_FLAT}</attributes>${REST}</measure>` +
        `<measure number="2"><attributes>${IN_F}</attributes>${REST}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings).toEqual([])
  })

  test('reports a later key in another transposition in a part of rests', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>2</fifths></key>${IN_B_FLAT}</attributes>${REST}</measure>` +
        `<measure number="2"><attributes><key><fifths>1</fifths></key>${IN_F}</attributes>` +
        `${REST}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 'key', 2],
    ])
  })

  test('keeps concert pitch where the part is given a transposition after its first note', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions></attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toBeUndefined()
    const second = part?.measures[1]?.sequences[0]?.content[0]
    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 2],
    ])
  })

  // The key of a measure with no note is converted with the transposition in
  // force at its end, which writes it with other fifths than the part's.
  test('reports a key in another transposition before the first note', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions>' +
        `<key><fifths>0</fifths></key>${IN_B_FLAT}</attributes></measure>` +
        `<measure number="2"><attributes>${IN_F}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 4, halfSteps: 7 })
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 'key', 1],
    ])
  })

  // Nothing in the first measure is written in a transposition, so the part
  // is fixed at its first note.
  test('takes the transposition of the first note after a measure with no note or key', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        '</measure>' +
        `<measure number="2"><attributes>${IN_F}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 4, halfSteps: 7 })
    expect(warnings).toEqual([])
  })

  test('takes the transposition of the first note after a measure that only moves the cursor', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '</attributes><forward><duration>4</duration></forward></measure>' +
        `<measure number="2"><attributes><transpose number="1"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>` +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 4, halfSteps: 7 })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unrepresentable:per-staff-transposition', 2],
    ])
  })

  test('takes the transposition of the first note after an empty measure at concert pitch', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions></attributes></measure>' +
        `<measure number="2"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings).toEqual([])
  })

  // A key stated partway is converted with the transposition the notes after
  // it are read in, here a horn in F reading no sharps or flats.
  test('converts a key stated partway with a change of instrument after it', () => {
    const { score, warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}<attributes><key><fifths>0</fifths></key></attributes>` +
        `<attributes>${IN_F}</attributes>${NOTE}</measure>` +
        `<measure number="2">${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(score.globalMeasures[1]?.key).toEqual({ fifths: -1 })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 1],
      ['unrepresentable:mid-measure-key', 1],
    ])
  })

  // The part changes back to the transposition it is written out in, which
  // loses nothing more.
  test('reports a change of instrument once where a later measure changes back', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>` +
        `<measure number="2"><attributes>${IN_F}</attributes>${NOTE}</measure>` +
        `<measure number="3"><attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 2],
    ])
  })

  // Staff 2 keeps the B-flat every staff was given in measure 1, and the
  // measure gives it none, so the report goes to the measure's first
  // <transpose>.
  test('reports staves left disagreeing at the first of two blocks of <transpose>', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose number="1"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        '</attributes><attributes>\n' +
        '<transpose number="1"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure, w.context.line])).toEqual([
      ['unrepresentable:per-staff-transposition', 2, 1],
      ['unrepresentable:transposition-change', 2, 1],
    ])
  })

  // The drop opens the check, and staff 2, now at concert pitch, was given
  // nothing in this measure, so the report goes to the first <transpose>.
  test('reports staves left disagreeing after a drop at the <transpose> after it', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>3</staves>' +
        '<transpose number="3"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes><staves>2</staves></attributes><attributes>\n' +
        '<transpose number="1"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(
      warnings
        .filter((w) => w.code === 'unrepresentable:per-staff-transposition')
        .map((w) => [w.context.measure, w.element, w.context.line]),
    ).toEqual([
      [1, 'transpose', 1],
      [2, 'transpose', 2],
    ])
  })

  // A staff keeps the transposition it was given until it is given another.
  test('says nothing where a later measure restates one staff alone', () => {
    const both =
      '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
      '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${both}</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings).toEqual([])
  })

  test("keeps the first staff's transposition where a later measure changes only the second", () => {
    const { score, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose number="2"><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )
    const second = score.parts[0]?.measures[1]?.sequences[0]?.content[0]

    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 2],
    ])
  })

  // A <transpose> naming no staff gives every staff, including those added
  // after it, and replaces what single staves were given before.
  test('gives every staff a transpose naming none, after single staves', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `<transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>` +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes><staves>3</staves>' +
        '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
    ])
  })

  // The part follows staff 2 until staff 2 is dropped. Staff 1 sounds as
  // written, so the part written out in B-flat changes instrument there.
  test('reports a change of instrument where a dropped staff takes the transposition with it', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><staves>1</staves></attributes>${NOTE}</measure>` +
        '<measure number="3"><attributes>' +
        '<transpose number="1"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    const second = part?.measures[1]?.sequences[0]?.content[0]
    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'C',
      octave: 4,
      alter: 0,
    })
    expect(warnings.map((w) => [w.code, w.context.measure, w.element])).toEqual([
      ['unrepresentable:per-staff-transposition', 1, 'transpose'],
      ['unsupported:element', 2, 'staves'],
      ['unrepresentable:transposition-change', 2, 'staves'],
    ])
  })

  // MusicXML writes <staves> before <transpose>, so one block can drop the
  // staff and give the staff left the same transposition.
  test('reports no change of instrument where the block that drops the staff gives the one left its transposition', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes><staves>1</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    const second = part?.measures[1]?.sequences[0]?.content[0]
    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unsupported:element', 2],
    ])
  })

  // The drop opens the measure's check, and the staves still disagree once a
  // later block gives the first staff a transposition of its own.
  test("reports staves left disagreeing after a drop at the measure's first <transpose>", () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>3</staves>' +
        '<transpose number="3"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes><staves>2</staves></attributes>' +
        '<attributes>\n' +
        '<transpose number="2"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure, w.element, w.context.line])).toEqual([
      ['unrepresentable:per-staff-transposition', 1, 'transpose', 1],
      ['unsupported:element', 2, 'staves', 1],
      ['unrepresentable:per-staff-transposition', 2, 'transpose', 2],
      ['unrepresentable:transposition-change', 2, 'staves', 1],
    ])
  })

  // Staff 2 is still the first staff given one, so nothing changes.
  test('reports no change of instrument where a dropped staff leaves the transposition in force', () => {
    const { part, warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>3</staves>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '<transpose number="3"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><staves>2</staves></attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    const second = part?.measures[1]?.sequences[0]?.content[0]
    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'B',
      octave: 3,
      alter: -1,
    })
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unsupported:element', 2],
    ])
  })

  // A staff the part drops loses what it was given. Added back, it takes the
  // transposition given to every staff.
  test('gives a staff added back the transposition every staff has', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        IN_B_FLAT +
        '<transpose number="2"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes><staves>1</staves></attributes>${NOTE}</measure>` +
        '<measure number="3"><attributes><staves>2</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unsupported:element', 2],
    ])
  })

  test('keeps what each staff was given where the part restates its staves', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        IN_B_FLAT +
        '<transpose number="2"><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes><staves>2</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unrepresentable:per-staff-transposition', 2],
    ])
  })

  // The part takes the first transposition it is given, where the first
  // staff sounds as written.
  test('takes the transposition of the only staff given one', () => {
    const { part, warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(part?.transposition).toEqual({ staffDistance: 1, halfSteps: 2 })
    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'unrepresentable:per-staff-transposition',
        'The staves of this part are transposed by different intervals, and MNX states one ' +
          'for the part. The notes follow the first staff that is given one.',
      ],
    ])
  })

  test('reports the one staff of three that no transpose names', () => {
    const { warnings } = read(
      inPart(
        '<staves>3</staves>' +
          '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
          '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-transposition'])
  })

  test('says nothing where the one staff named is at concert pitch too', () => {
    const { warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(warnings).toEqual([])
  })

  test('applies a transpose stating no number to every staff it does not name', () => {
    const { warnings } = read(
      inPart(
        '<staves>2</staves>' +
          '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
          '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
        NOTE,
      ),
    )

    expect(warnings).toEqual([])
  })

  test('refuses a transpose naming a staff the part does not have', () => {
    expect(() =>
      read(
        inPart(
          '<staves>2</staves>' +
            '<transpose number="3"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
          NOTE,
        ),
      ),
    ).toThrow('<transpose> has a "number" of 3, outside the range 1 to 2.')
  })

  test('reports staves transposed differently at the first that differs', () => {
    const source = inPart(
      '<staves>2</staves>\n' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>\n' +
        '<transpose number="2"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>',
      NOTE,
    )
    const { warnings } = read(source)

    const differing = warnings.find((w) => w.code === 'unrepresentable:per-staff-transposition')
    expect(differing?.context.line).toBe(3)
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
    expect(second?.kind === 'event' && notesOf(second)[0]?.pitch).toEqual({
      step: 'A',
      octave: 3,
      alter: 0,
    })
    expect(warnings.list().map((one) => one.code)).toEqual(['unrepresentable:transposition-change'])
  })

  test('reports a change of instrument at the <transpose> that changes it', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>` +
        '<measure number="2"><attributes>\n' +
        '<transpose><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.element, w.context.line])).toEqual([['transpose', 2]])
  })

  // The notes follow staff 1, so the change is reported at the <transpose>
  // given to it, not at the block's first.
  test('reports a change of instrument at the <transpose> of the staff the notes follow', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>\n' +
        '<transpose number="1"><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(
      warnings
        .map((w) => [w.code, w.element, w.context.line])
        .filter(([code]) => code === 'unrepresentable:transposition-change'),
    ).toEqual([['unrepresentable:transposition-change', 'transpose', 2]])
  })

  // The warnings name a <transpose> of the measure they are about.
  test('reports one staff changing instrument, and the staves now differing, at its <transpose>', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">\n' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        '<transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>\n` +
        '<measure number="2"><attributes>' +
        '<transpose number="1"><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure, w.context.line])).toEqual([
      ['unrepresentable:per-staff-transposition', 2, 3],
      ['unrepresentable:transposition-change', 2, 3],
    ])
  })

  test('reports a change of instrument written in two <attributes> once', () => {
    const changed = (staff: number) =>
      `<attributes><transpose number="${String(staff)}">` +
      '<diatonic>-2</diatonic><chromatic>-3</chromatic></transpose></attributes>'
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        `<measure number="2">${changed(1)}${changed(2)}${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 2],
    ])
  })

  test('reports a change of instrument that changes back within the measure', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>\n` +
        '<measure number="2"><attributes>' +
        '<transpose><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}<attributes>${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure, w.context.line])).toEqual([
      ['unrepresentable:transposition-change', 2, 2],
    ])
  })

  test('reports a change of instrument at the staff that changes, not one restated before it', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${IN_B_FLAT}</attributes>${NOTE}</measure>` +
        '<measure number="2"><attributes>' +
        '<transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' +
        '\n<transpose number="1"><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>' +
        `</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.line])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unrepresentable:transposition-change', 2],
    ])
  })

  test('reports a change of instrument once, not where a later measure restates another staff', () => {
    const transpose = (staff: number, diatonic: number, chromatic: number) =>
      `<transpose number="${String(staff)}"><diatonic>${String(diatonic)}</diatonic>` +
      `<chromatic>${String(chromatic)}</chromatic></transpose>`
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions><staves>2</staves>' +
        `${transpose(1, -1, -2)}${transpose(2, -2, -3)}</attributes>${NOTE}</measure>` +
        `<measure number="2"><attributes>${transpose(1, -2, -3)}</attributes>${NOTE}</measure>` +
        `<measure number="3"><attributes>${transpose(2, -2, -3)}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:per-staff-transposition', 1],
      ['unrepresentable:transposition-change', 2],
    ])
  })

  test('reports a change of instrument once, not where a later measure restates it', () => {
    const inF = '<transpose><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>'
    const { warnings } = read(
      '<score-partwise><part id="P1">' +
        `<measure number="1"><attributes><divisions>4</divisions>${IN_B_FLAT}</attributes>` +
        `${NOTE}</measure>` +
        `<measure number="2"><attributes>${inF}</attributes>${NOTE}</measure>` +
        `<measure number="3"><attributes>${inF}</attributes>${NOTE}</measure>` +
        '</part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
      ['unrepresentable:transposition-change', 2],
    ])
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

// MNX applies a part's flip point to its notes as well as its signature: past
// the point it writes each note one letter over, so a concert B for a B-flat
// clarinet in five flats comes out as D-flat rather than C-sharp. The note is
// stated in the score's key, so that the flip brings back what the part wrote.
describe('a note in a part that flips its key signature', () => {
  /** Written a minor third above what it sounds. */
  const IN_A = '<transpose><diatonic>-2</diatonic><chromatic>-3</chromatic></transpose>'

  const pitched = (step: string, alter: number, octave: number, grace = false) =>
    `<note>${grace ? '<grace/>' : ''}<pitch><step>${step}</step>` +
    `${alter !== 0 ? `<alter>${String(alter)}</alter>` : ''}<octave>${String(octave)}</octave></pitch>` +
    `${grace ? '' : '<duration>4</duration>'}<type>quarter</type></note>`

  /** Two parts, each a list of measures as [key, notes]. */
  const twoParts = (
    concert: readonly [number, string][],
    transposing: readonly [number, string][],
    transpose = IN_B_FLAT,
  ) => {
    const measures = (list: readonly [number, string][], extra: string) =>
      list
        .map(
          ([fifths, body], index) =>
            `<measure number="${String(index + 1)}"><attributes>` +
            (index === 0 ? '<divisions>4</divisions>' : '') +
            `<key><fifths>${String(fifths)}</fifths></key>${index === 0 ? extra : ''}` +
            `</attributes>${body}</measure>`,
        )
        .join('')
    return (
      '<score-partwise><part-list>' +
      '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
      '<score-part id="P2"><part-name>Clarinet</part-name></score-part>' +
      '</part-list>' +
      `<part id="P1">${measures(concert, '')}</part>` +
      `<part id="P2">${measures(transposing, transpose)}</part>` +
      '</score-partwise>'
    )
  }

  const pitchesOf = (source: string) => {
    const { score, warnings } = read(source)
    const pitches = (score.parts[1]?.measures ?? []).map((measure) =>
      (measure.sequences[0]?.content ?? []).flatMap((item) => {
        if (item.kind === 'event') return notesOf(item).map((note) => note.pitch)
        if (item.kind === 'grace')
          return item.content.flatMap((e) => notesOf(e).map((n) => n.pitch))
        return []
      }),
    )
    return { pitches, warnings, flipAt: score.parts[1]?.transposition?.keyFifthsFlipAt }
  }

  test('states a note past the point in the score’s key', () => {
    const { pitches, warnings, flipAt } = pitchesOf(
      twoParts([[5, pitched('B', 0, 3)]], [[-5, pitched('D', -1, 4)]]),
    )

    expect(flipAt).toBe(7)
    expect(pitches).toEqual([[{ step: 'B', octave: 3, alter: 0 }]])
    expect(warnings).toEqual([])
  })

  test('states a grace note past the point in the score’s key', () => {
    const { pitches } = pitchesOf(
      twoParts([[5, pitched('B', 0, 3)]], [[-5, pitched('E', -1, 4, true) + pitched('D', -1, 4)]]),
    )

    expect(pitches).toEqual([
      [
        { step: 'C', octave: 4, alter: 1 },
        { step: 'B', octave: 3, alter: 0 },
      ],
    ])
  })

  test('leaves a note short of the point as the part wrote it', () => {
    const { pitches, flipAt } = pitchesOf(
      twoParts(
        [
          [0, pitched('C', 0, 4)],
          [5, pitched('B', 0, 3)],
        ],
        [
          [2, pitched('D', 0, 4)],
          [-5, pitched('D', -1, 4)],
        ],
      ),
    )

    expect(flipAt).toBe(7)
    expect(pitches).toEqual([
      [{ step: 'C', octave: 4, alter: 0 }],
      [{ step: 'B', octave: 3, alter: 0 }],
    ])
  })

  // MNX states whether an accidental is drawn, not which one. Spelled in the
  // score's key, a note needs one in the concert score exactly where it
  // needs one in the part: a D-flat in five flats needs none, and is a B in
  // five sharps; a D natural needs one, and is a B-sharp.
  test('needs an accidental in the score’s key where the part drew one', () => {
    const { score } = read(
      twoParts(
        [[5, pitched('B', 0, 3)]],
        [
          [
            -5,
            pitched('D', -1, 4) +
              '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
              '<type>quarter</type><accidental>natural</accidental></note>',
          ],
        ],
      ),
    )
    const notes = (score.parts[1]?.measures[0]?.sequences[0]?.content ?? []).flatMap((item) =>
      item.kind === 'event' ? notesOf(item) : [],
    )

    expect(notes.map(({ pitch, accidentalDisplay }) => ({ pitch, accidentalDisplay }))).toEqual([
      { pitch: { step: 'B', octave: 3, alter: 0 }, accidentalDisplay: undefined },
      { pitch: { step: 'B', octave: 3, alter: 1 }, accidentalDisplay: { show: true } },
    ])
  })

  // Moved a letter, a written E natural in five flats would be a concert C
  // double-sharp, and a written B-sharp a G triple-sharp. Each keeps the
  // spelling its interval gives, and states the letter MNX moves it back by:
  // D, plus one letter down, is written E again once the flip moves it up.
  test('keeps a note off the key’s scale in the spelling nearer the score’s key', () => {
    const { mnx } = convertValid(
      twoParts(
        [[5, pitched('B', 0, 3)]],
        [[-5, pitched('E', 0, 4) + pitched('B', 1, 4) + pitched('F', 0, 4)]],
      ),
    )
    const notes = (mnx.parts[1]?.measures[0]?.sequences[0]?.content ?? []).flatMap((item) =>
      'notes' in item ? (item.notes ?? []) : [],
    )

    expect(notes.map(({ pitch, written }) => ({ pitch, written }))).toEqual([
      { pitch: { step: 'D', octave: 4 }, written: { diatonicDelta: -1 } },
      { pitch: { step: 'A', octave: 4, alter: 1 }, written: { diatonicDelta: -1 } },
      { pitch: { step: 'D', octave: 4, alter: 1 }, written: undefined },
    ])
  })

  // A written A natural in five flats sounds G, or F double-sharp once moved
  // by the flip. Both sit six fifths from the middle of five sharps, and the
  // flip's spelling keeps the raised fifth the part wrote.
  test('takes the flip’s spelling where both are as near the score’s key', () => {
    const { mnx } = convertValid(twoParts([[5, pitched('B', 0, 3)]], [[-5, pitched('A', 0, 4)]]))
    const [event] = mnx.parts[1]?.measures[0]?.sequences[0]?.content ?? []

    expect(event && 'notes' in event ? event.notes : undefined).toEqual([
      { pitch: { step: 'F', octave: 4, alter: 2 } },
    ])
  })

  // In five sharps a written E keeps the concert D; in six it takes C
  // double-sharp. Tied over the barline, the later note takes the spelling of
  // the note the tie starts on.
  test.each([
    ['five sharps into six', [5, 6], [-5, -4], { step: 'D', octave: 5, alter: 0 }, -1],
    ['six sharps into five', [6, 5], [-4, -5], { step: 'C', octave: 5, alter: 2 }, undefined],
  ] as const)(
    'spells the later note of a tie from %s as the note the tie starts on',
    (_name, concert, part, pitch, diatonicDelta) => {
      const tied = (type: string) =>
        '<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration>' +
        `<tie type="${type}"/><type>quarter</type>` +
        `<notations><tied type="${type}"/></notations></note>`
      const { score } = read(
        twoParts(
          [
            [concert[0], pitched('B', 0, 3)],
            [concert[1], pitched('B', 0, 3)],
          ],
          [
            [part[0], tied('start')],
            [part[1], tied('stop')],
          ],
        ),
      )
      const notes = (score.parts[1]?.measures ?? []).flatMap((measure) =>
        (measure.sequences[0]?.content ?? []).flatMap((item) =>
          item.kind === 'event' ? notesOf(item) : [],
        ),
      )

      expect(
        notes.map((note) => ({ pitch: note.pitch, diatonicDelta: note.diatonicDelta })),
      ).toEqual([
        { pitch, diatonicDelta },
        { pitch, diatonicDelta },
      ])
      expect(notes[0]?.ties).toEqual([{ kind: 'target', target: notes[1]?.id, crossVoice: false }])
    },
  )

  // An A clarinet asks for eight flats where the score is in five, and writes
  // four sharps instead, so its notes come back one letter under.
  test('states a note past a point below zero in the score’s key', () => {
    const { pitches, flipAt } = pitchesOf(
      twoParts([[-5, pitched('D', -1, 4)]], [[4, pitched('E', 0, 4)]], IN_A),
    )

    expect(flipAt).toBe(-8)
    expect(pitches).toEqual([[{ step: 'D', octave: 4, alter: -1 }]])
  })

  // A tuplet, a skip, a rest, a whole-measure rest and a note struck on a kit all
  // pass through, and only the pitches are re-spelled.
  test('re-spells every pitch of a measure past the point, and nothing else', () => {
    const triplet = (step: string) =>
      `<note><pitch><step>${step}</step><alter>-1</alter><octave>4</octave></pitch>` +
      '<duration>2</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>'
    const measure = (number: number, attributes: string, body: string) =>
      `<measure number="${String(number)}"><attributes>${attributes}</attributes>${body}</measure>`
    const { mnx } = convertValid(
      '<score-partwise><part-list>' +
        '<score-part id="P1"><part-name>Flute</part-name></score-part>' +
        '<score-part id="P2"><part-name>Clarinet</part-name></score-part>' +
        '</part-list><part id="P1">' +
        measure(1, '<divisions>6</divisions><key><fifths>5</fifths></key>', pitched('B', 0, 3)) +
        measure(2, '', pitched('B', 0, 3)) +
        '</part><part id="P2">' +
        measure(
          1,
          `<divisions>6</divisions><key><fifths>-5</fifths></key>${IN_B_FLAT}`,
          triplet('D') +
            triplet('E') +
            triplet('G') +
            '<forward><duration>6</duration></forward>' +
            '<note><unpitched><display-step>B</display-step><display-octave>4</display-octave>' +
            '</unpitched><duration>6</duration><type>quarter</type></note>' +
            '<note><rest/><duration>6</duration><type>quarter</type></note>',
        ) +
        measure(2, '', '<note><rest measure="yes"/><duration>24</duration></note>') +
        '</part></score-partwise>',
    )

    const [first, second] = mnx.parts[1]?.measures ?? []
    expect(JSON.stringify(first?.sequences[0]?.content)).toMatch(/kitComponent/)
    expect(
      JSON.stringify(first?.sequences[0]?.content)
        .match(/"pitch":\{[^}]*\}/g)
        ?.map((pitch) => JSON.parse(pitch.slice('"pitch":'.length)) as unknown),
    ).toEqual([
      { step: 'B', octave: 3 },
      { step: 'C', octave: 4, alter: 1 },
      { step: 'E', octave: 4 },
    ])
    expect(second?.sequences[0]?.fullMeasure).toBeDefined()
  })
})
