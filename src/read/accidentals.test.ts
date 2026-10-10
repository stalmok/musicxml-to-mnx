// MusicXML draws an accidental only where it writes an <accidental> element.
// A note with an alter and no <accidental> takes it from the key or an
// earlier note. MNX also marks only the notes whose accidental shows. The
// support block is tested in tests/support-block.test.ts.

import { convertValid } from '../../tests/support/convert.js'
import { notesOf, readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import type { Note } from '../model/score.js'

function note(step: string, alter: string, body: string): string {
  const alterElement = alter === '' ? '' : `<alter>${alter}</alter>`
  return (
    `<note><pitch><step>${step}</step>${alterElement}<octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`
  )
}

function score(body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions></attributes>' +
    `${body}</measure></part></score-partwise>`
  )
}

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  const notes = (result.parts[0]?.measures[0]?.sequences[0]?.content ?? []).flatMap((item) =>
    item.kind === 'event' ? notesOf(item) : [],
  )
  return { score: result, notes, warnings: warnings.list() }
}

describe('a shown accidental', () => {
  test('marks the note whose accidental the source draws', () => {
    const { notes } = read(score(note('G', '1', '<accidental>sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay).toEqual({ show: true, enclosure: undefined })
  })

  test('leaves a note whose accidental the source does not draw unmarked', () => {
    const { notes } = read(score(note('B', '-1', '')))

    expect(notes[0]?.accidentalDisplay).toBeUndefined()
  })

  test('reads a natural, which cancels a prior accidental', () => {
    const { notes } = read(score(note('B', '', '<accidental>natural</accidental>')))

    expect(notes[0]?.accidentalDisplay?.show).toBe(true)
  })
})

describe('an enclosed accidental', () => {
  test('reads a cautionary accidental in parentheses', () => {
    const { notes } = read(
      score(note('F', '1', '<accidental parentheses="yes">sharp</accidental>')),
    )

    expect(notes[0]?.accidentalDisplay?.enclosure).toBe('parentheses')
  })

  test('reads an accidental in brackets', () => {
    const { notes } = read(score(note('F', '1', '<accidental bracket="yes">sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay?.enclosure).toBe('brackets')
  })

  test('leaves a plain accidental without an enclosure', () => {
    const { notes } = read(score(note('F', '1', '<accidental>sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay?.enclosure).toBeUndefined()
  })
})

// A cautionary or editorial accidental shows where the rules do not require
// it. MNX's accidental-display `force` states this.
describe('a forced accidental', () => {
  test('forces a cautionary accidental', () => {
    const { notes } = read(score(note('F', '1', '<accidental cautionary="yes">sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay?.force).toBe(true)
  })

  test('forces an editorial accidental', () => {
    const { notes } = read(score(note('F', '1', '<accidental editorial="yes">sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay?.force).toBe(true)
  })

  test('does not force a plain accidental', () => {
    const { notes } = read(score(note('F', '1', '<accidental>sharp</accidental>')))

    expect(notes[0]?.accidentalDisplay?.force).toBeUndefined()
  })
})

describe('a chord note', () => {
  test('carries its own accidental', () => {
    const { notes } = read(
      score(
        note('C', '', '') +
          '<note><chord/><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch>' +
          '<duration>4</duration><type>quarter</type>' +
          '<accidental>flat</accidental></note>',
      ),
    )
    const flat = notes.find((n: Note) => n.pitch.step === 'E')

    expect(flat?.accidentalDisplay?.show).toBe(true)
  })
})

// MusicXML states an alteration in semitones as a decimal, so a microtone
// can be a quarter of one. MNX's alter is a whole number of semitones. The
// note takes the nearest, and a half-way alteration takes the smaller.
describe('an altered note', () => {
  test.each([
    ['0.5', 0],
    ['-0.5', 0],
    ['1.5', 1],
    ['-1.5', -1],
    ['1.75', 2],
    ['.25', 0],
  ])('converts an alteration of %s semitones as %i', (written, expected) => {
    const { notes, warnings } = read(score(note('C', written, '')))

    expect(notes[0]?.pitch.alter).toBe(expected)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:microtone'])
    expect(warnings[0]?.message).toContain(`altered by ${written} semitones`)
  })

  // MNX's alter is an integer with no range.
  test('converts a triple sharp', () => {
    const { notes, warnings } = read(score(note('C', '3', '')))

    expect(notes[0]?.pitch.alter).toBe(3)
    expect(warnings).toEqual([])
  })

  test('converts an alteration of ten semitones', () => {
    const { notes, warnings } = read(score(note('C', '-10', '')))

    expect(notes[0]?.pitch.alter).toBe(-10)
    expect(warnings).toEqual([])
  })

  // Number() reads all of these but "flat".
  test.each(['flat', '0x1', '1e1', ' '])('refuses an alteration of "%s"', (written) => {
    expect(() => read(score(note('C', written, '')))).toThrow('not a number of semitones')
  })
})

// An <accidental> names the glyph drawn. MNX draws the one the note's alter
// calls for, so a glyph that agrees with the alter loses nothing.
describe('the glyph an accidental is drawn as', () => {
  test.each([
    ['-3', 'triple-flat'],
    ['-2', 'flat-flat'],
    ['-1', 'flat'],
    ['', 'natural'],
    ['0', 'natural'],
    ['1', 'sharp'],
    ['2', 'double-sharp'],
    ['3', 'triple-sharp'],
  ])('says nothing of an alter of "%s" drawn as %s', (alter, glyph) => {
    const { warnings } = read(score(note('C', alter, `<accidental>${glyph}</accidental>`)))

    expect(warnings).toEqual([])
  })

  // The microtone is reported where the alter is read, and the glyph is the
  // one that alter calls for.
  test.each([
    ['-1.5', 'three-quarters-flat'],
    ['-0.5', 'quarter-flat'],
    ['0.5', 'quarter-sharp'],
    ['1.5', 'three-quarters-sharp'],
  ])('reports only the microtone of an alter of %s drawn as %s', (alter, glyph) => {
    const { warnings } = read(score(note('C', alter, `<accidental>${glyph}</accidental>`)))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:microtone'])
  })

  test('reports a courtesy natural drawn before a sharp, and draws the sharp', () => {
    const { notes, warnings } = read(
      score(note('F', '1', '<accidental>natural-sharp</accidental>')),
    )

    expect(notes[0]?.accidentalDisplay?.show).toBe(true)
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'unrepresentable:accidental',
        'accidental',
        'An accidental drawn as "natural-sharp" cannot be expressed in MNX, which draws the ' +
          'one the note\'s alter of 1 calls for, "sharp".',
      ],
    ])
  })

  // Two sharps side by side are another glyph than the double sharp.
  test('reports a double sharp drawn as two sharps', () => {
    const { warnings } = read(score(note('F', '2', '<accidental>sharp-sharp</accidental>')))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:accidental'])
  })

  test('reports a glyph that disagrees with the alter', () => {
    const { warnings } = read(score(note('F', '', '<accidental>sharp</accidental>')))

    expect(warnings.map((w) => w.message)).toEqual([
      'An accidental drawn as "sharp" cannot be expressed in MNX, which draws the one the ' +
        'note\'s alter of 0 calls for, "natural".',
    ])
  })

  test('names no glyph for an alter no glyph is drawn for', () => {
    const { warnings } = read(score(note('C', '4', '<accidental>sharp</accidental>')))

    expect(warnings.map((w) => w.message)).toEqual([
      'An accidental drawn as "sharp" cannot be expressed in MNX, which draws the one the ' +
        "note's alter of 4 calls for.",
    ])
  })

  test('reports the SMuFL glyph of an other accidental along with it', () => {
    const { warnings } = read(
      score(note('F', '1', '<accidental smufl="accSagittal5CommaUp">other</accidental>')),
    )

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unrepresentable:accidental', undefined],
    ])
  })

  test.each([
    'sharp',
    'natural',
    'flat',
    'double-sharp',
    'sharp-sharp',
    'flat-flat',
    'natural-sharp',
    'natural-flat',
    'quarter-flat',
    'quarter-sharp',
    'three-quarters-flat',
    'three-quarters-sharp',
    'sharp-down',
    'sharp-up',
    'natural-down',
    'natural-up',
    'flat-down',
    'flat-up',
    'double-sharp-down',
    'double-sharp-up',
    'flat-flat-down',
    'flat-flat-up',
    'arrow-down',
    'arrow-up',
    'triple-sharp',
    'triple-flat',
    'slash-quarter-sharp',
    'slash-sharp',
    'slash-flat',
    'double-slash-flat',
    'sharp-1',
    'sharp-2',
    'sharp-3',
    'sharp-5',
    'flat-1',
    'flat-2',
    'flat-3',
    'flat-4',
    'sori',
    'koron',
    'other',
  ])('takes %s as a glyph MusicXML defines', (glyph) => {
    const { warnings } = read(score(note('C', '4', `<accidental>${glyph}</accidental>`)))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:accidental'])
  })

  test('reports a glyph MusicXML does not define as a source problem', () => {
    const { notes, warnings } = read(score(note('F', '1', '<accidental>sharpish</accidental>')))

    expect(notes[0]?.accidentalDisplay?.show).toBe(true)
    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'unresolved:element-value',
        'An <accidental> of "sharpish" is not one MusicXML defines, and the accidental the ' +
          'alter calls for is drawn instead.',
      ],
    ])
  })

  test('writes a reported glyph onto schema-valid MNX', () => {
    const { mnx } = convertValid(score(note('F', '1', '<accidental>sharp-up</accidental>')))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'notes' in event && event.notes?.[0]?.accidentalDisplay).toEqual({
      show: true,
    })
  })
})
