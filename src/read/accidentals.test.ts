// MusicXML draws an accidental only where it writes an <accidental> element;
// a note with an alter but none is covered by the key or a note before it.
// MNX states this the same way round, marking the notes whose accidental
// shows. What the document then declares once, in its support block, is a
// fact about the whole conversion and is tested in tests/support-block.test.ts.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
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
  const result = readScore(parseXmlRoot(source), warnings)
  const notes = (result.parts[0]?.measures[0]?.sequences[0]?.content ?? []).flatMap((item) =>
    item.kind === 'event' ? item.notes : [],
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

// A cautionary or editorial accidental is shown though the rules would not
// require it, which is exactly what MNX's accidental-display `force` means.
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

// MusicXML counts an alteration in semitones, written as a decimal so a
// microtone can state a quarter of one. MNX's alter is a whole number of
// them, so the note takes the nearest, and a half-way alteration takes the
// smaller.
describe('an altered note', () => {
  test.each([
    ['0.5', 0],
    ['-0.5', 0],
    ['1.5', 1],
    ['-1.5', -1],
    ['1.75', 2],
  ])('converts an alteration of %s semitones as %i', (written, expected) => {
    const { notes, warnings } = read(score(note('C', written, '')))

    expect(notes[0]?.pitch.alter).toBe(expected)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:microtone'])
    expect(warnings[0]?.message).toContain(`altered by ${written} semitones`)
  })

  // MNX states alter as a plain integer with no range, so an alteration
  // beyond a double sharp goes over as readily as a sharp.
  test('converts a triple sharp', () => {
    const { notes, warnings } = read(score(note('C', '3', '')))

    expect(notes[0]?.pitch.alter).toBe(3)
    expect(warnings).toEqual([])
  })

  test('refuses an alteration that is not a number', () => {
    expect(() => read(score(note('C', 'flat', '')))).toThrow('not a number of semitones')
  })
})
