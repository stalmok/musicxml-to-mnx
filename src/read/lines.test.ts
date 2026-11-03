import { describe, expect, test } from 'vitest'
import { readValid } from '../../tests/support/read.js'
import type { SequenceItem } from '../model/score.js'

const BACKUP = '<backup><duration>4</duration></backup>'
const REST = '<note><rest/><duration>4</duration><type>quarter</type><voice>1</voice></note>'

function note(pitch: string, body = '', type = 'quarter'): string {
  const [step = '', octave = ''] = pitch
  const duration = type === 'quarter' ? 4 : 2
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${String(duration)}</duration><type>${type}</type><voice>1</voice>${body}</note>`
  )
}

const tied = (type: string): string =>
  `<tie type="${type}"/><notations><tied type="${type}"/></notations>`
const beamed = (pitch: string, marker: string): string =>
  note(pitch, `<beam number="1">${marker}</beam>`, 'eighth')

function pitches(content: readonly SequenceItem[]): string[] {
  return content.flatMap((item) => {
    if (item.kind === 'space' || item.kind === 'grace') return []
    if (item.kind !== 'event') return pitches(item.content)
    if (item.body.kind === 'rest') return ['rest']
    return item.body.notes.map((n) => `${n.pitch.step}${String(n.pitch.octave)}`)
  })
}

/** Each measure's sequences, as the voice each is named and what it sounds. */
function linesOf(...bodies: string[]): string[][] {
  const inner = bodies
    .map(
      (body, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
        `${body}</measure>`,
    )
    .join('')
  const score = readValid(`<score-partwise><part id="P1">${inner}</part></score-partwise>`)
  return (score.parts[0]?.measures ?? []).map((measure) =>
    measure.sequences.map(
      (sequence) => `${sequence.voice ?? '-'}: ${pitches(sequence.content).join(' ')}`,
    ),
  )
}

describe('lines of a voice across the barline', () => {
  test('keeps the name of a line a tie carries on where two lines cross', () => {
    const lines = linesOf(
      note('C5') + BACKUP + note('E4', tied('start')),
      note('E4', tied('stop')) + BACKUP + note('C3'),
    )

    expect(lines).toEqual([
      ['1: C5', '1.2: E4'],
      ['1.2: E4', '1: C3'],
    ])
  })

  test('keeps the name of a line a tie carries on across a measure of rests', () => {
    const lines = linesOf(
      note('C5') + BACKUP + note('E4', tied('start')),
      REST + BACKUP + REST,
      note('E4', tied('stop')) + BACKUP + note('C3'),
    )

    expect(lines[2]).toEqual(['1.2: E4', '1: C3'])
  })

  test('keeps the name of a line that carries on the beam it left open', () => {
    const lines = linesOf(
      note('C5') + BACKUP + beamed('E4', 'begin') + beamed('F4', 'continue'),
      beamed('D5', 'continue') + beamed('E5', 'end') + BACKUP + note('C4'),
    )

    expect(lines[1]).toEqual(['1.2: D5 E5', '1: C4'])
  })

  test('names the line a tie carries out of a measure of one line after the voice', () => {
    const lines = linesOf(note('E4', tied('start')), note('G4') + BACKUP + note('E4', tied('stop')))

    expect(lines[1]).toEqual(['1.2: G4', '1: E4'])
  })

  test('names a measure that writes the voice in one line after the voice', () => {
    const lines = linesOf(
      note('C5') + BACKUP + note('E4', tied('start')),
      note('E4', tied('stop')),
      note('C5') + BACKUP + note('E4'),
    )

    expect(lines).toEqual([['1: C5', '1.2: E4'], ['1: E4'], ['1: C5', '1.2: E4']])
  })

  // The one line may be the line the tie starts in.
  test('carries no name past a measure that sounds the voice in one line', () => {
    const lines = linesOf(
      note('C5') + BACKUP + note('E4', tied('start')),
      note('D4'),
      note('E4', tied('stop')) + BACKUP + note('C3'),
    )

    expect(lines[2]).toEqual(['1: E4', '1.2: C3'])
  })
})
