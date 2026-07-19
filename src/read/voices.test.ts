// MusicXML writes a measure as one stream with a cursor: <backup> rewinds it
// so another voice can be written over the same span, and <chord> attaches a
// note to the one before it. MNX states each voice as its own sequence. These
// cover the translation between the two.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { fraction } from '../fraction.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

const DIVISIONS = '<attributes><divisions>4</divisions></attributes>'

/** A note of `duration` quarters, in `voice`, at the given pitch step. */
function note(step: string, quarters: number, voice = '1', extra = ''): string {
  return (
    `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(quarters * 4)}</duration><voice>${voice}</voice></note>`
  )
}

function measure(body: string): string {
  return `<score-partwise><part id="P1"><measure number="1">${DIVISIONS}${body}</measure></part></score-partwise>`
}

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readScore(parseXmlRoot(source), warnings)
  return { measure: result.parts[0]?.measures[0], warnings: warnings.list() }
}

function readFailure(source: string): MusicXMLError {
  try {
    read(source)
  } catch (e) {
    if (e instanceof MusicXMLError) return e
    throw e
  }
  throw new Error('Expected the read to fail, but it succeeded.')
}

describe('voices', () => {
  test('gives each voice its own sequence', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          note('E', 1, '1') +
          '<backup><duration>8</duration></backup>' +
          note('G', 2, '2'),
      ),
    )

    expect(result?.sequences).toHaveLength(2)
    expect(result?.sequences[0]?.voice).toBe('1')
    expect(result?.sequences[1]?.voice).toBe('2')
  })

  test('keeps voices in the order they first appear', () => {
    const { measure: result } = read(
      measure(note('C', 1, '2') + '<backup><duration>4</duration></backup>' + note('G', 1, '1')),
    )

    expect(result?.sequences.map((s) => s.voice)).toEqual(['2', '1'])
  })

  test('treats a measure with no voice given as a single voice', () => {
    const { measure: result } = read(
      measure('<note><rest/><duration>4</duration><type>quarter</type></note>'),
    )

    expect(result?.sequences).toHaveLength(1)
    expect(result?.sequences[0]?.voice).toBeUndefined()
  })

  test('puts each voice’s own notes in it', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>8</duration></backup>' + note('G', 2, '2')),
    )

    expect(result?.sequences[0]?.content).toHaveLength(1)
    expect(result?.sequences[1]?.content).toHaveLength(1)
  })
})

describe('chords', () => {
  test('folds a chord note into the event before it', () => {
    const { measure: result } = read(measure(note('C', 1) + note('E', 1, '1', '<chord/>')))
    const content = result?.sequences[0]?.content

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'event' && content[0].notes).toHaveLength(2)
  })

  test('does not let a chord note advance the cursor', () => {
    const { measure: result } = read(
      measure(
        note('C', 1) +
          note('E', 1, '1', '<chord/>') +
          '<backup><duration>4</duration></backup>' +
          note('G', 1, '2'),
      ),
    )

    // Voice 2 starts where voice 1 started, so it needs no space before it.
    expect(result?.sequences[1]?.content).toHaveLength(1)
  })

  test('rejects a chord note with nothing to attach to', () => {
    expect(readFailure(measure(note('C', 1, '1', '<chord/>'))).message).toContain(
      'no note for it to join',
    )
  })

  test('rejects a rest marked as part of a chord', () => {
    expect(
      readFailure(measure(note('C', 1) + '<note><chord/><rest/><duration>4</duration></note>'))
        .message,
    ).toContain('rest cannot be part of a chord')
  })

  test('rejects chord notes that disagree about how long they last', () => {
    expect(readFailure(measure(note('C', 1) + note('E', 2, '1', '<chord/>'))).message).toContain(
      'lasts',
    )
  })
})

// A grace note is squeezed in before the beat and takes no time of its own.
// Until grace groups are converted it has to be left out, but leaving it in
// the cursor's path would shift every note after it.
describe('grace notes', () => {
  const GRACE =
    '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>'

  test('does not take time from the measure', () => {
    const { measure: result } = read(
      measure(GRACE + note('C', 1) + '<backup><duration>4</duration></backup>' + note('G', 1, '2')),
    )

    // Voice 2 starts where voice 1 did, so no space stands before it.
    expect(result?.sequences[1]?.content[0]?.kind).toBe('event')
  })

  test('is left out rather than written as an ordinary note', () => {
    const { measure: result } = read(measure(GRACE + note('C', 1)))

    expect(result?.sequences[0]?.content).toHaveLength(1)
  })

  test('says that it was left out', () => {
    const { warnings } = read(measure(GRACE + note('C', 1)))

    expect(warnings.some((w) => w.message.includes('grace note'))).toBe(true)
  })
})

describe('the measure cursor', () => {
  test('fills the gap when a voice starts partway through the measure', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('G', 1, '2')),
    )
    const first = result?.sequences[1]?.content[0]

    expect(first?.kind).toBe('space')
    expect(first?.kind === 'space' && first.duration).toEqual(fraction(1, 4))
  })

  test('treats forward as a gap in the voice it lands in', () => {
    const { measure: result } = read(
      measure('<forward><duration>4</duration></forward>' + note('C', 1)),
    )
    const content = result?.sequences[0]?.content

    expect(content?.[0]?.kind).toBe('space')
    expect(content).toHaveLength(2)
  })

  test('rejects a backup past the start of the measure', () => {
    expect(
      readFailure(measure(note('C', 1) + '<backup><duration>16</duration></backup>')).message,
    ).toContain('before the start of the measure')
  })

  test.each(['backup', 'forward'])('rejects a <%s> that states no duration', (name) => {
    expect(readFailure(measure(note('C', 1) + `<${name}/>`)).message).toContain('states no')
  })

  test('rejects two notes of one voice overlapping', () => {
    expect(
      readFailure(
        measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
      ).message,
    ).toContain('overlaps')
  })
})
