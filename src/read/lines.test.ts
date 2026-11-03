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

  // The E4 line of the first measure holds the rank the C4 line takes in the
  // second, which the third follows.
  test('keeps the name of a line a measure wrote over a line of its rank it left out', () => {
    const lines = linesOf(
      note('C5') + BACKUP + note('E4') + BACKUP + note('C4', tied('start')),
      beamed('C5', 'begin') +
        beamed('D5', 'continue') +
        BACKUP +
        note('C4', '<beam number="1">begin</beam>' + tied('stop'), 'eighth') +
        beamed('D4', 'continue'),
      note('E5') + BACKUP + beamed('E4', 'continue') + beamed('F4', 'end'),
    )

    expect(lines.slice(1)).toEqual([
      ['1: C5 D5', '1.3: C4 D4'],
      ['1: E5', '1.3: E4 F4'],
    ])
  })

  test('keeps the name of a line of the rank of a beam that two lines carry on', () => {
    const lines = linesOf(
      note('C5') + BACKUP + beamed('E4', 'begin') + beamed('F4', 'continue'),
      beamed('D5', 'continue') +
        beamed('E5', 'end') +
        BACKUP +
        beamed('G4', 'continue') +
        beamed('A4', 'end'),
    )

    expect(lines[1]).toEqual(['1: D5 E5', '1.2: G4 A4'])
  })

  test('takes no line by a beam where two are left open and neither is of its rank', () => {
    const lines = linesOf(
      beamed('C5', 'begin') +
        beamed('D5', 'continue') +
        BACKUP +
        beamed('E4', 'begin') +
        beamed('F4', 'continue'),
      note('G5') + BACKUP + note('B4') + BACKUP + beamed('C4', 'continue') + beamed('D4', 'end'),
    )

    expect(lines[1]).toEqual(['1: G5', '1.2: B4', '1.3: C4 D4'])
  })

  test('takes the line a beam names over the line a tie names', () => {
    const lines = linesOf(
      note('G4', tied('start')) + BACKUP + beamed('E4', 'begin') + beamed('F4', 'continue'),
      note('G4', '<beam number="1">continue</beam>' + tied('stop'), 'eighth') +
        beamed('A4', 'end') +
        BACKUP +
        note('C4'),
    )

    expect(lines[1]).toEqual(['1.2: G4 A4', '1: C4'])
  })

  test('keeps the name of a line a tie carries on past a grace note before its stop', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch>' +
      '<type>eighth</type><voice>1</voice></note>'
    const lines = linesOf(
      note('C5') + BACKUP + note('E4', tied('start')),
      grace + note('E4', tied('stop')) + BACKUP + note('C3'),
    )

    expect(lines[1]).toEqual(['1.2: E4', '1: C3'])
  })

  test('keeps the name of a line a tie carries on out of a two-note tremolo', () => {
    const tremolo = (pitch: string, type: string, tie = '') => {
      const [step = '', octave = ''] = pitch
      return (
        `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
        `<duration>2</duration><type>quarter</type><voice>1</voice>${tie && `<tie type="${tie}"/>`}` +
        `<notations>${tie && `<tied type="${tie}"/>`}` +
        `<ornaments><tremolo type="${type}">2</tremolo></ornaments></notations></note>`
      )
    }
    const lines = linesOf(
      note('C5') + BACKUP + tremolo('E4', 'start') + tremolo('G4', 'stop', 'start'),
      note('G4', tied('stop')) + BACKUP + note('C3'),
    )

    expect(lines).toEqual([
      ['1: C5', '1.2: E4 G4'],
      ['1.2: G4', '1: C3'],
    ])
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
