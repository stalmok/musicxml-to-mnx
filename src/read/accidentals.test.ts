// MusicXML draws an accidental only where it writes an <accidental> element;
// a note with an alter but none is covered by the key or a note before it.
// MNX states this the same way round, marking the notes whose accidental
// shows, and the document says once, in its support block, that it does so.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { writeMnx } from '../write/mnx.js'
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

// Whether the document draws its accidentals is a fact about the whole of it,
// so it is read off the finished score rather than accumulated while it is
// built. That keeps it a property of what was converted rather than of the
// order the reader happened to visit things in.
describe('the document declaring it states accidentals', () => {
  test('says so once any note draws an accidental', () => {
    const { score: result } = read(score(note('G', '1', '<accidental>sharp</accidental>')))

    expect(writeMnx(result).mnx.support).toEqual({ useAccidentalDisplay: true })
  })

  test('does not claim it where the source never draws one', () => {
    const { score: result } = read(score(note('C', '', '')))

    expect(writeMnx(result).mnx.support).toBeUndefined()
  })

  test('finds one drawn inside a tuplet or a grace group', () => {
    const { score: result } = read(
      score(
        '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type>' +
          '<accidental>sharp</accidental></note>' +
          note('C', '', ''),
      ),
    )

    expect(writeMnx(result).mnx.support).toEqual({ useAccidentalDisplay: true })
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
