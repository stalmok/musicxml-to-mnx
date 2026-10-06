// MusicXML marks a tie or a slur at both ends and leaves the connection
// implied. MNX states it once, on the note or event where it begins, as a
// reference to the one where it ends. Resolving that means holding the open
// ends until their partner turns up, which can be several measures later.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { WarningCollector } from './collector.js'
import { accountsForItself, measureResidue, pairSpans } from './spanners.js'
import type { SlurEnd, SpanEnd } from './spanners.js'
import type { Event, Note } from '../model/score.js'
import { parseXmlRoot } from '../xml/parse.js'

const WRITTEN = { context: {}, element: parseXmlRoot('<slur/>') }

const DIVISIONS = '<attributes><divisions>4</divisions></attributes>'

function note(step: string, body = '', voice = '1'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type><voice>${voice}</voice>${body}</note>`
  )
}

function tied(type: string): string {
  return `<tie type="${type}"/><notations><tied type="${type}"/></notations>`
}

function slur(type: string, number = '1', placement = ''): string {
  return `<notations><slur type="${type}" number="${number}"${placement}/></notations>`
}

function measures(...bodies: string[]): string {
  const inner = bodies
    .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
    .join('')
  return `<score-partwise><part id="P1">${inner}</part></score-partwise>`
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readValid(source, warnings)
  const events = (score.parts[0]?.measures ?? []).flatMap(
    (measure) =>
      measure.sequences[0]?.content.filter((item): item is Event => item.kind === 'event') ?? [],
  )
  return { events, notes: events.flatMap((event) => event.notes), warnings: warnings.list() }
}

/** Every note of every voice, with grace groups walked into. */
function readAllVoices(source: string) {
  const warnings = new WarningCollector()
  const score = readValid(source, warnings)
  const events = (score.parts[0]?.measures ?? []).flatMap((measure) =>
    measure.sequences.flatMap((sequence) =>
      sequence.content.flatMap((item): Event[] => {
        if (item.kind === 'event') return [item]
        if (item.kind === 'grace') return [...item.content]
        return []
      }),
    ),
  )
  return { notes: events.flatMap((event) => event.notes), warnings: warnings.list() }
}

describe('ties', () => {
  test('points the note where the tie starts at the note where it ends', () => {
    const { notes } = read(measures(DIVISIONS + note('C', tied('start')) + note('C', tied('stop'))))
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
    expect(second.ties).toEqual([])
  })

  test('carries a tie across a barline', () => {
    const { notes } = read(measures(DIVISIONS + note('C', tied('start')), note('C', tied('stop'))))
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
  })

  // Ties are matched on pitch across the part, so one may end in a different
  // voice from the one it started in. MNX says so on the tie; without the
  // mark, a consumer reads the target as the same voice's next note.
  test('marks a tie whose two ends are in different voices', () => {
    const { notes } = read(
      measures(DIVISIONS + note('C', tied('start')), note('C', tied('stop'), '2')),
    )
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: true }])
  })

  test('does not mark a tie between measures as crossing voices', () => {
    const { notes } = read(
      measures(DIVISIONS + note('C', tied('start'), '2'), note('C', tied('stop'), '2')),
    )
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
  })

  // A note stating no voice and one stating an empty voice are both the
  // unnamed voice, which is how the sequences bucket them.
  test('treats a missing voice and an empty voice as the same voice', () => {
    const unvoiced =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type>${tied('start')}</note>`
    const emptyVoiced =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice></voice>${tied('stop')}</note>`
    const { notes } = read(measures(DIVISIONS + unvoiced, emptyVoiced))
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
  })

  // A note in the middle of a chain both ends the tie before it and starts the
  // next, so it carries two <tie> elements.
  test('follows a chain of ties through the note that both ends and starts one', () => {
    const middle = `<tie type="stop"/><tie type="start"/>`
    const { notes } = read(
      measures(DIVISIONS + note('C', tied('start')) + note('C', middle) + note('C', tied('stop'))),
    )
    const [first, second, third] = notes as [Note, Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
    expect(second.ties).toEqual([{ target: third.id, crossVoice: false }])
    expect(third.ties).toEqual([])
  })

  // A tie can end on the same sounding pitch spelled differently: G sharp
  // tied to A flat. The tie joins the sound, so the spelling does not part
  // the two ends.
  test('ties across an enharmonic respelling of the same sounding pitch', () => {
    const sharp =
      '<note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('start')}</note>`
    const flat =
      '<note><pitch><step>A</step><alter>-1</alter><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('stop')}</note>`
    const { notes, warnings } = read(measures(DIVISIONS + sharp + flat))
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  // B sharp 3 and C 4 are one sounding pitch whose spellings sit either side
  // of the octave boundary.
  test('ties across the octave boundary a respelling moves over', () => {
    const bSharp =
      '<note><pitch><step>B</step><alter>1</alter><octave>3</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('start')}</note>`
    const cNatural =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('stop')}</note>`
    const { notes, warnings } = read(measures(DIVISIONS + bSharp + cNatural))
    const [first, second] = notes as [Note, Note]

    expect(first.ties).toEqual([{ target: second.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  // One letter two octaves apart is two different sounds. Sources write such a
  // stray pair in error. Both ends are reported.
  test('keeps two octaves of one letter apart', () => {
    const low =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('start')}</note>`
    const high =
      '<note><pitch><step>C</step><octave>5</octave></pitch>' +
      `<duration>4</duration><type>quarter</type><voice>1</voice>${tied('stop')}</note>`
    const { notes, warnings } = read(measures(DIVISIONS + low + high))

    expect(notes.every((n) => n.ties.length === 0)).toBe(true)
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:spanner', 'unclosed:spanner'])
  })

  test('ties the note of the same pitch, not merely the next one', () => {
    const { notes } = read(
      measures(DIVISIONS + note('C', tied('start')) + note('G') + note('C', tied('stop'))),
    )
    const [first, , third] = notes as [Note, Note, Note]

    expect(first.ties).toEqual([{ target: third.id, crossVoice: false }])
  })

  test('reports a tie the source never ends', () => {
    const { warnings, notes } = read(measures(DIVISIONS + note('C', tied('start')) + note('G')))

    expect(warnings.map((w) => w.code)).toContain('unclosed:spanner')
    expect(notes[0]?.ties).toEqual([])
  })

  test('reports a tie that ends without having started', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', tied('stop'))))

    expect(warnings.map((w) => w.code)).toContain('unclosed:spanner')
  })

  // A measure holding two voices is written one voice at a time with a
  // <backup> between them, so a stop belonging to the first voice can be
  // written before the start belonging to the second even though the music
  // has it the other way round.
  test('joins a tie whose stop is written before its start', () => {
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS +
          '<note><rest/><duration>8</duration><type>half</type><voice>1</voice></note>' +
          note('A', tied('stop')) +
          '<backup><duration>12</duration></backup>' +
          `<note><pitch><step>A</step><octave>4</octave></pitch>` +
          `<duration>8</duration><type>half</type><voice>2</voice>${tied('start')}</note>`,
      ),
    )
    const stopped = notes.find((n) => n.ties.length === 0)
    const started = notes.find((n) => n.ties.length > 0)

    expect(started?.ties).toEqual([{ target: stopped?.id, crossVoice: true }])
    expect(warnings).toEqual([])
  })

  // A tie joins a note to the next sounding of its pitch, and a note never
  // crosses a barline, so both ends of a real tie sit in one measure or in
  // adjacent ones. A stop further away than that belongs to nothing.
  test('reports a far-off stop rather than tying it to a stale start', () => {
    const { notes, warnings } = readAllVoices(
      measures(DIVISIONS + note('A', tied('start')), note('G'), note('A', tied('stop'), '2')),
    )

    expect(notes.every((n) => n.ties.length === 0)).toBe(true)
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:spanner', 'unclosed:spanner'])
  })

  // The one-measure reach is measured between the two ends, not from the
  // start of the part, so a tie crossing voices holds as well in the fourth
  // measure as in the first.
  test('joins a tie crossing voices late in the part', () => {
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS + note('G'),
        note('G'),
        note('G'),
        note('A', tied('start')) +
          '<backup><duration>4</duration></backup>' +
          note('A', tied('stop'), '2'),
      ),
    )
    const started = notes.find((n) => n.ties.length > 0)

    expect(started?.ties).toEqual([{ target: notes[notes.length - 1]?.id, crossVoice: true }])
    expect(warnings).toEqual([])
  })

  // A same-voice stop is the source's own pairing and holds at any
  // distance. Scores tie a note to the next sounding of its pitch measures
  // away, across rests.
  test('keeps a tie its own voice states across an intervening measure of rest', () => {
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS + note('A', tied('start')),
        '<note><rest/><duration>4</duration><voice>1</voice></note>',
        note('A', tied('stop')),
      ),
    )
    const started = notes.find((n) => n.ties.length > 0)
    const stopped = notes[notes.length - 1]

    expect(started?.ties).toEqual([{ target: stopped?.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  // A tie joins a note to the next note its voice sounds. A start its voice
  // has sounded past is stray, and a stop after it belongs elsewhere.
  test('does not join a same-voice start that other notes of the voice sound after', () => {
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS + note('C', tied('start')),
        note('E'),
        note('E') + '<backup><duration>4</duration></backup>' + note('C', tied('start'), '2'),
        note('C', tied('stop')),
      ),
    )
    const [stray, , , crossing, stopped] = notes as [Note, Note, Note, Note, Note]

    expect(stray.ties).toEqual([])
    expect(crossing.ties).toEqual([{ target: stopped.id, crossVoice: true }])
    expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([['unclosed:spanner', 1]])
  })

  // A chord member of a grace chord sounds before the beat as the whole
  // chord does, so its tie orders like any grace note's, through the chord
  // path it is read on.
  test('joins a tie from a grace chord member into another voice', () => {
    const graceChord =
      `<note><grace/><pitch><step>C</step><octave>5</octave></pitch>` +
      `<type>eighth</type><voice>2</voice></note>` +
      `<note><grace/><chord/><pitch><step>A</step><octave>4</octave></pitch>` +
      `<type>eighth</type><voice>2</voice>${tied('start')}</note>`
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS +
          note('A', tied('stop')) +
          '<backup><duration>4</duration></backup>' +
          graceChord +
          note('E', '', '2'),
      ),
    )
    const started = notes.find((n) => n.ties.length > 0)
    const stopped = notes.find((n) => n.pitch.step === 'A' && n.ties.length === 0)

    expect(started?.pitch).toEqual({ step: 'A', octave: 4, alter: 0 })
    expect(started?.ties).toEqual([{ target: stopped?.id, crossVoice: true }])
    expect(warnings).toEqual([])
  })

  // A grace note sounds before the beat, so its tie into the beat note holds
  // whichever voice writes its end first. The other voice's stop is written
  // ahead of the grace note that starts the tie.
  test('joins a tie from a grace note into another voice at the same point', () => {
    const { notes, warnings } = readAllVoices(
      measures(
        DIVISIONS +
          note('A', tied('stop')) +
          '<backup><duration>4</duration></backup>' +
          `<note><grace/><pitch><step>A</step><octave>4</octave></pitch>` +
          `<type>eighth</type><voice>2</voice>${tied('start')}</note>` +
          note('C', '', '2'),
      ),
    )
    const started = notes.find((n) => n.ties.length > 0)
    const stopped = notes.find((n) => n.pitch.step === 'A' && n.ties.length === 0)

    expect(started?.ties).toEqual([{ target: stopped?.id, crossVoice: true }])
    expect(warnings).toEqual([])
  })
})

// <tie> is the sound of a tie and <tied> is the notation, so a note that is
// not sounded, such as a cue, states the tie in <tied> alone.
describe('a tie stated only as <tied>', () => {
  const tiedOnly = (type: string) => `<notations><tied type="${type}"/></notations>`

  test('points the note where it starts at the note where it ends', () => {
    const { notes } = read(
      measures(DIVISIONS + note('C', tiedOnly('start')) + note('C', tiedOnly('stop'))),
    )
    const [first, second] = notes

    expect(first?.ties).toEqual([{ target: second?.id, crossVoice: false }])
    expect(second?.ties).toEqual([])
  })

  test('names <tied> where an edge of its own finds no other', () => {
    const { warnings } = read(
      measures(DIVISIONS + note('C', tiedOnly('start')) + note('D', tiedOnly('stop'))),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unclosed:spanner', 'tied'],
      ['unclosed:spanner', 'tied'],
    ])
  })

  // MusicXML writes the middle of a chain as one "continue", where <tie>
  // writes a stop and a start.
  test('follows a chain through a note that continues it', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note('C', tiedOnly('start')) +
          note('C', tiedOnly('continue')) +
          note('C', tiedOnly('stop')),
      ),
    )
    const [first, second, third] = notes

    expect(first?.ties).toEqual([{ target: second?.id, crossVoice: false }])
    expect(second?.ties).toEqual([{ target: third?.id, crossVoice: false }])
    expect(third?.ties).toEqual([])
  })

  test('carries the side it is drawn on, as a sounded tie does', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note('C', '<notations><tied type="start" orientation="over"/></notations>') +
          note('C', tiedOnly('stop')),
      ),
    )

    expect(notes[0]?.ties[0]?.side).toBe('up')
  })

  // Where the source states both, <tie> is what the tie is read from, so the
  // note is tied once rather than twice.
  test('does not double a tie the source also states as <tie>', () => {
    const { notes } = read(measures(DIVISIONS + note('C', tied('start')) + note('C', tied('stop'))))

    expect(notes[0]?.ties).toHaveLength(1)
  })

  // <notations> puts no order on its children, so a note in the middle of a
  // chain can state its start before its stop. Taken as written, that start
  // would be the most recent one open when the stop arrives, and the note
  // would tie to itself.
  test('ends the tie before it and then starts the next, however they are written', () => {
    const startFirst = '<notations><tied type="start"/><tied type="stop"/></notations>'
    const { notes, warnings } = read(
      measures(
        DIVISIONS +
          note('C', tiedOnly('start')) +
          note('C', startFirst) +
          note('C', tiedOnly('stop')),
      ),
    )
    const [first, second, third] = notes

    expect(first?.ties).toEqual([{ target: second?.id, crossVoice: false }])
    expect(second?.ties).toEqual([{ target: third?.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  // A "continue" starts the next tie of the chain, so the side it states is
  // that tie's, the way a start's is.
  test('carries the side a continuing edge states', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note('C', tiedOnly('start')) +
          note('C', '<notations><tied type="continue" orientation="under"/></notations>') +
          note('C', tiedOnly('stop')),
      ),
    )

    expect(notes[1]?.ties[0]?.side).toBe('down')
  })

  // <tie> is the sound of the tie, and a let-ring rings out with no ending
  // note, so it states no edge for a chain to be read from. The drawn chain
  // beside it is still the note's.
  test('reads the drawn chain beside a <tie> that states only a let-ring', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note('C', `<tie type="let-ring"/>${tiedOnly('start')}`) +
          note('C', tiedOnly('stop')),
      ),
    )

    expect(notes[0]?.ties).toContainEqual({ target: notes[1]?.id, crossVoice: false })
  })

  test('reports an edge whose type it cannot read', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', tiedOnly('sideways'))))

    expect(warnings.map((w) => w.message)).toContain(
      'A <tied> of type "sideways" is not one MusicXML defines, and is not carried over.',
    )
  })
})

// A tie whose notes state <tie> and no <tied> sounds but is not drawn. MNX's
// tie is always drawn.
describe('a tie stated only as <tie>', () => {
  const tieOnly = (type: string) => `<tie type="${type}"/>`
  const tiedOnly = (type: string) => `<notations><tied type="${type}"/></notations>`

  test('is reported, not written, where neither note states <tied>', () => {
    const { notes, warnings } = read(
      measures(DIVISIONS + note('C', tieOnly('start')) + note('C', tieOnly('stop'))),
    )

    expect(notes.map((one) => one.ties)).toEqual([[], []])
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'unrepresentable:element',
        'tie',
        'A tie stated by <tie> with no <tied> on either note sounds but is not drawn, ' +
          'and cannot be expressed in MNX, where a tie is always drawn.',
      ],
    ])
  })

  test('is reported in the measure where it starts', () => {
    const { warnings } = read(
      measures(DIVISIONS + note('C', tieOnly('start')), note('C', tieOnly('stop'))),
    )

    expect(warnings.map((w) => w.context.measure)).toEqual([1])
  })

  test('is written where its start states <tied>', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS + note('C', tieOnly('start') + tiedOnly('start')) + note('C', tieOnly('stop')),
      ),
    )

    expect(notes[0]?.ties).toEqual([{ target: notes[1]?.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  test('is written where its stop states <tied>', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS + note('C', tieOnly('start')) + note('C', tieOnly('stop') + tiedOnly('stop')),
      ),
    )

    expect(notes[0]?.ties).toEqual([{ target: notes[1]?.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  // The middle note's <tied> stop draws the first tie of the chain. Its
  // second tie has no <tied> at either note.
  test('drops only the tie of a chain that neither of its notes draws', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS +
          note('C', tied('start')) +
          note('C', tieOnly('stop') + tieOnly('start') + tiedOnly('stop')) +
          note('C', tieOnly('stop')),
      ),
    )
    const [first, second, third] = notes

    expect(first?.ties).toEqual([{ target: second?.id, crossVoice: false }])
    expect(second?.ties).toEqual([])
    expect(third?.ties).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  // A "continue" draws both the tie it ends and the tie it starts.
  test('is written where a <tied> continue draws it', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS +
          note('C', tieOnly('start')) +
          note('C', tieOnly('stop') + tieOnly('start') + tiedOnly('continue')) +
          note('C', tieOnly('stop')),
      ),
    )
    const [first, second, third] = notes

    expect(first?.ties).toEqual([{ target: second?.id, crossVoice: false }])
    expect(second?.ties).toEqual([{ target: third?.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })
})

// <tied> is the visual side of a tie. Most of it repeats <tie>, but let-ring
// and the drawn side are stated only there.
describe('let-ring and the drawn side', () => {
  test('reads a let-ring <tied> as an lv tie with no target', () => {
    const { notes, warnings } = read(
      measures(DIVISIONS + note('C', '<notations><tied type="let-ring"/></notations>')),
    )

    expect(notes[0]?.ties).toEqual([{ crossVoice: false, lv: true }])
    // A let-ring is a type this reader has a reading for, so it is not one of
    // the types it reports.
    expect(warnings).toEqual([])
  })

  // MNX's tie states one side, on the note the tie starts from, so a note
  // whose edges state two sides gives the tie the first.
  test('takes the first side its edges state, not the last', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note(
            'C',
            '<notations><tied type="start" orientation="over"/>' +
              '<tied type="continue" orientation="under"/></notations>',
          ) +
          note('C', '<notations><tied type="stop"/></notations>'),
      ),
    )

    expect(notes[0]?.ties[0]?.side).toBe('up')
  })

  test('reads the side a tie is drawn on', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note(
            'C',
            '<tie type="start"/><notations><tied type="start" orientation="over"/></notations>',
          ) +
          note('C', tied('stop')),
      ),
    )

    expect(notes[0]?.ties[0]?.side).toBe('up')
  })

  // Orientation states the curve itself, placement only where the notation
  // sits, so where the two disagree the orientation is the side.
  test('lets the orientation of a tie outweigh its placement', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note(
            'C',
            '<tie type="start"/><notations>' +
              '<tied type="start" orientation="under" placement="above"/></notations>',
          ) +
          note('C', tied('stop')),
      ),
    )

    expect(notes[0]?.ties[0]?.side).toBe('down')
  })

  // MNX's tie states one side, on the note it starts from, so a side stated
  // on the stop is read and dropped rather than reported as an unread
  // attribute.
  test('keeps the side the start states when the stop states another', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS +
          note(
            'C',
            '<tie type="start"/><notations><tied type="start" orientation="over"/></notations>',
          ) +
          note(
            'C',
            '<tie type="stop"/><notations>' +
              '<tied type="stop" orientation="under" placement="below"/></notations>',
          ),
      ),
    )

    expect(notes[0]?.ties[0]?.side).toBe('up')
    expect(warnings.map((w) => w.code)).not.toContain('unsupported:attribute')
  })

  // A note in the middle of a chain states both edges. The side belongs to the
  // tie the note starts, so the stop's is read and dropped even though it is
  // written first.
  test('takes the side from the start where the note also ends a tie', () => {
    const { notes, warnings } = read(
      measures(
        DIVISIONS +
          note('C', '<tie type="start"/><notations><tied type="start"/></notations>') +
          note(
            'C',
            '<tie type="stop"/><tie type="start"/><notations>' +
              '<tied type="stop" orientation="under"/>' +
              '<tied type="start" orientation="over"/></notations>',
          ) +
          note('C', '<tie type="stop"/><notations><tied type="stop"/></notations>'),
      ),
    )

    expect(notes[1]?.ties[0]?.side).toBe('up')
    expect(warnings).toEqual([])
  })

  test('writes let-ring and side onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      measures(
        DIVISIONS +
          note(
            'C',
            '<tie type="start"/><notations><tied type="start" placement="below"/></notations>',
          ) +
          note('C', tied('stop')) +
          note('D', '<notations><tied type="let-ring"/></notations>'),
      ),
    )
    const json = JSON.stringify(mnx)

    expect(json).toContain('"lv":true')
    expect(json).toContain('"side":"down"')
  })
})

describe('slurs', () => {
  test('points the event where the slur starts at the event where it ends', () => {
    const { events } = read(
      measures(DIVISIONS + note('C', slur('start')) + note('G', slur('stop'))),
    )
    const [first, second] = events as [Event, Event]

    expect(first.slurs).toEqual([{ target: second.id, side: undefined }])
    expect(second.slurs).toEqual([])
  })

  test('carries a slur across a barline', () => {
    const { events } = read(measures(DIVISIONS + note('C', slur('start')), note('G', slur('stop'))))
    const [first, second] = events as [Event, Event]

    expect(first.slurs[0]?.target).toBe(second.id)
  })

  test('keeps two slurs apart by the number the source gives them', () => {
    const { events } = read(
      measures(
        DIVISIONS +
          note('C', slur('start', '1')) +
          note('D', slur('start', '2')) +
          note('E', slur('stop', '1')) +
          note('F', slur('stop', '2')),
      ),
    )
    const [first, second, third, fourth] = events as [Event, Event, Event, Event]

    expect(first.slurs[0]?.target).toBe(third.id)
    expect(second.slurs[0]?.target).toBe(fourth.id)
  })

  // An edge that writes no number is number 1.
  test.each([
    ['<slur type="start"/>', '<slur type="stop" number="1"/>'],
    ['<slur type="start" number="1"/>', '<slur type="stop"/>'],
  ])('joins %s to %s', (start, stop) => {
    const { events, warnings } = read(
      measures(
        DIVISIONS +
          note('C', `<notations>${start}</notations>`) +
          note('D', `<notations>${stop}</notations>`),
      ),
    )
    const [first, second] = events as [Event, Event]

    expect(first.slurs[0]?.target).toBe(second.id)
    expect(warnings).toEqual([])
  })

  // A measure holding two voices is written as one pass per voice with a
  // <backup> between them. A slur that runs from the second voice to the first
  // therefore has its stop written before its start, although the music has
  // the start first. The pairing follows the music.
  test('joins a slur whose stop is written before its start', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('C', '', '1') +
          note('D', slur('stop'), '1') +
          '<backup><duration>8</duration></backup>' +
          note('G', slur('start'), '2') +
          note('A', '', '2'),
      ),
      warnings,
    )
    const events = (score.parts[0]?.measures[0]?.sequences ?? []).flatMap((sequence) =>
      sequence.content.filter((item): item is Event => item.kind === 'event'),
    )
    const [, stopsOn, startsOn] = events as [Event, Event, Event, Event]

    expect(startsOn.slurs).toEqual([{ target: stopsOn.id, side: undefined }])
    expect(warnings.list()).toEqual([])
  })

  // Exporters number a slur within the voice they write it in, so two voices
  // sounding at once each hold their own slur numbered 1. Paired as one
  // stream in time order, the first voice's stop would close the second
  // voice's start.
  test('keeps two voices holding one slur number apart', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('C', slur('start'), '1') +
          note('D', slur('stop'), '1') +
          '<backup><duration>8</duration></backup>' +
          note('E', slur('start'), '2') +
          note('F', slur('stop'), '2'),
      ),
      warnings,
    )
    const voices = (score.parts[0]?.measures[0]?.sequences ?? []).map((sequence) =>
      sequence.content.filter((item): item is Event => item.kind === 'event'),
    )
    const [upper, lower] = voices as [Event[], Event[]]

    expect(upper[0]?.slurs[0]?.target).toBe(upper[1]?.id)
    expect(lower[0]?.slurs[0]?.target).toBe(lower[1]?.id)
    expect(warnings.list()).toEqual([])
  })

  // A voice keeps its own slurs where its ends account for each other, even
  // where another voice writes a stray stop nearer than the voice's own.
  test("keeps a voice's own slur over a nearer stray stop beside it", () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('C', slur('start'), '1') +
          '<backup><duration>4</duration></backup>' +
          note('G', '', '2'),
        note('A', slur('stop'), '2'),
        note('D', slur('stop'), '1'),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )

    expect(eventsOf(0, 0)[0]?.slurs[0]?.target).toBe(eventsOf(2, 0)[0]?.id)
    expect(warnings.list().map((w) => w.message)).toEqual([
      'A slur ends where none had started, and is not carried over.',
    ])
  })

  // Where a voice's ends do not account for each other, the slur runs into
  // another voice, and the stop takes the most recent start of any voice:
  // the nearest partner it can have. Kept to its own voice, this start would
  // take the stop four measures on instead of the one written beside it.
  test('joins the near partner in another voice, not the far one in its own', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('C', slur('start'), '1') +
          '<backup><duration>4</duration></backup>' +
          note('G', slur('stop'), '2'),
        note('D', '', '1'),
        note('E', slur('start'), '1') + note('F', slur('stop'), '1'),
        note('A', slur('stop'), '1'),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )

    // The start of measure one closes in the voice beside it, and measure
    // three's slur stays where the source wrote it.
    expect(eventsOf(0, 0)[0]?.slurs[0]?.target).toBe(eventsOf(0, 1)[0]?.id)
    expect(eventsOf(2, 0)[0]?.slurs[0]?.target).toBe(eventsOf(2, 0)[1]?.id)
    expect(warnings.list().map((w) => w.message)).toEqual([
      'A slur ends where none had started, and is not carried over.',
    ])
  })

  // Where both voices leave an end over, both pair across the part, and each
  // stop still takes the open start of its own voice. Taking the most recent
  // start of any voice would join the two hands.
  test('keeps two voices apart in the pass across the part', () => {
    const warnings = new WarningCollector()
    const both = (body: string) =>
      note('C', body, '1') + '<backup><duration>4</duration></backup>' + note('G', body, '2')
    const score = readValid(
      measures(
        DIVISIONS + both(slur('start')),
        both(slur('stop')),
        // A second stop in each voice, which neither voice can account for,
        // so both streams pair across the part rather than on their own.
        both(slur('stop')),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )

    expect(eventsOf(0, 0)[0]?.slurs[0]?.target).toBe(eventsOf(1, 0)[0]?.id)
    expect(eventsOf(0, 1)[0]?.slurs[0]?.target).toBe(eventsOf(1, 1)[0]?.id)
    expect(warnings.list().map((w) => w.message)).toEqual([
      'A slur ends where none had started, and is not carried over.',
      'A slur ends where none had started, and is not carried over.',
    ])
  })

  // A voice's own stream can balance by coincidence. Here voice 1's number 2
  // holds one start and one stop, so counting alone says it accounts for
  // itself. But the start slurs into voice 2 in the same measure, and the
  // stop ends a slur voice 2 starts two measures later. Pairing the voice's
  // own two ends would invent a 3-measure span and drop both real slurs.
  test('does not pair two ends of one number that only balance by coincidence', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('B', slur('start', '1') + slur('start', '2'), '1') +
          note('C', slur('stop', '1'), '1') +
          '<backup><duration>8</duration></backup>' +
          note('D', slur('start', '1'), '2') +
          note('E', slur('stop', '2') + slur('stop', '1'), '2'),
        note('F', slur('start', '2'), '2'),
        note('G', slur('stop', '2'), '1'),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )
    const [b4, c5] = eventsOf(0, 0) as [Event, Event]
    const [d4, e4] = eventsOf(0, 1) as [Event, Event]
    const [f4] = eventsOf(1, 0) as [Event]
    const [g4] = eventsOf(2, 0) as [Event]

    // Number 1 is each voice's own, unaffected: B4 -> C5 and D4 -> E4.
    expect(b4.slurs.map((s) => s.target)).toEqual([c5.id, e4.id])
    expect(d4.slurs.map((s) => s.target)).toEqual([e4.id])
    // Number 2 is the two real cross-voice slurs: B4 -> E4 in the one
    // measure they share, and F4 -> G4 two measures later.
    expect(f4.slurs.map((s) => s.target)).toEqual([g4.id])
    expect(warnings.list()).toEqual([])
  })

  // A voice's own ends left over in a measure say nothing about whether its
  // slurs cross into another voice: a slur spanning two measures always leaves
  // a start over in the one and a stop over in the other, so a voice reading
  // its own leftover ends would call every such slur a crossing and hand it to
  // the pass across the part, where a stray end beside it wins.
  test('weighs another voice against a pair, not the voice the pair is in', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        // Voice 1 opens the slur; voice 2 leaves a stray stop beside it.
        DIVISIONS +
          note('C', slur('start'), '1') +
          '<backup><duration>4</duration></backup>' +
          note('G', slur('stop'), '2'),
        // Voice 1 closes it and opens another in the same measure, which is
        // what leaves it an end over at both edges.
        note('D', slur('stop'), '1') + note('E', slur('start'), '1'),
        note('F', slur('stop'), '1'),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )

    // C closes on D, the stop its own voice wrote, not on the stray stop in
    // the voice beside it.
    expect(eventsOf(0, 0)[0]?.slurs[0]?.target).toBe(eventsOf(1, 0)[0]?.id)
    expect(eventsOf(1, 0)[1]?.slurs[0]?.target).toBe(eventsOf(2, 0)[0]?.id)
    expect(warnings.list().map((w) => w.message)).toEqual([
      'A slur ends where none had started, and is not carried over.',
    ])
  })

  // The measure a crossing is confirmed at, on the start's side, is the
  // pair's own measure or the one after it: a slur running into another voice
  // is closed there or in the measure that follows. Looking backwards instead
  // finds nothing, and the pair is read as the voice's own.
  test('confirms a crossing at the start from the measure after it', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS + note('C', '', '1'),
        note('D', slur('start'), '1'),
        // Voice 2 writes a stop where voice 1's slur has not reached yet,
        // and opens one of its own after it: an end left over on each side,
        // in the measure after voice 1's start.
        note('A', slur('stop'), '2') +
          note('B', slur('start'), '2') +
          '<backup><duration>8</duration></backup>' +
          '<note><rest/><duration>4</duration><type>quarter</type><voice>1</voice></note>' +
          note('E', slur('stop'), '1'),
      ),
      warnings,
    )
    const eventsOf = (measure: number, sequence: number) =>
      (score.parts[0]?.measures[measure]?.sequences[sequence]?.content ?? []).filter(
        (item): item is Event => item.kind === 'event',
      )

    // D's slur takes the nearer stop in the voice beside it, and the start
    // voice 2 leaves open closes on voice 1's stop: two slurs crossing the
    // two voices, with nothing left over. Read as voice 1's own, the two
    // stray ends beside it would both be reported instead.
    expect(eventsOf(1, 0)[0]?.slurs[0]?.target).toBe(eventsOf(2, 0)[0]?.id)
    expect(eventsOf(2, 0)[1]?.slurs[0]?.target).toBe(eventsOf(2, 1)[1]?.id)
    expect(warnings.list()).toEqual([])
  })

  // A grace note takes none of the measure's time, so it begins where the
  // note it ornaments begins. The slur from one to the other therefore has
  // both ends at one point, and the document says which end is which.
  test('joins a slur from a grace note to the note it ornaments', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          '<note><grace/><pitch><step>B</step><octave>3</octave></pitch>' +
          '<type>eighth</type><voice>1</voice>' +
          '<notations><slur type="start" number="1"/></notations></note>' +
          note('C', slur('stop')),
      ),
      warnings,
    )
    const content = score.parts[0]?.measures[0]?.sequences[0]?.content ?? []
    const grace = content.flatMap((item) => (item.kind === 'grace' ? item.content : []))[0]
    const main = content.filter((item): item is Event => item.kind === 'event')[0]

    expect(grace?.slurs[0]?.target).toBe(main?.id)
    expect(main?.slurs).toEqual([])
    expect(warnings.list()).toEqual([])
  })

  // A grace note sounds before the beat, so its end comes first even where
  // another voice writes the other end at the same point ahead of it. A
  // left-hand grace flourish slurred up into the right hand's chord is
  // written that way round.
  test('joins a slur from a grace note into another voice at the same point', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS +
          note('C', slur('stop'), '1') +
          '<backup><duration>4</duration></backup>' +
          '<note><grace/><pitch><step>F</step><octave>2</octave></pitch>' +
          '<type>eighth</type><voice>2</voice>' +
          '<notations><slur type="start" number="1"/></notations></note>' +
          note('G', '', '2'),
      ),
      warnings,
    )
    const content = (score.parts[0]?.measures[0]?.sequences ?? []).flatMap(
      (sequence) => sequence.content,
    )
    const grace = content.flatMap((item) => (item.kind === 'grace' ? item.content : []))[0]
    const chord = content.filter((item): item is Event => item.kind === 'event')[0]

    expect(grace?.slurs[0]?.target).toBe(chord?.id)
    expect(warnings.list()).toEqual([])
  })

  test('reads which side of the notes the slur is drawn on', () => {
    const { events } = read(
      measures(
        DIVISIONS + note('C', slur('start', '1', ' placement="below"')) + note('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.side).toBe('down')
  })

  test('reads the side from the orientation of the slur', () => {
    const { events } = read(
      measures(
        DIVISIONS + note('C', slur('start', '1', ' orientation="over"')) + note('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.side).toBe('up')
  })

  test('lets the orientation of a slur outweigh its placement', () => {
    const { events } = read(
      measures(
        DIVISIONS +
          note('C', slur('start', '1', ' orientation="under" placement="above"')) +
          note('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.side).toBe('down')
  })

  // An S-shaped slur bends one way at the start and the other at the end,
  // which MNX states as side and sideEnd.
  test('states the side the stop bends to as sideEnd where it differs', () => {
    const { events } = read(
      measures(
        DIVISIONS +
          note('C', slur('start', '1', ' orientation="over"')) +
          note('G', slur('stop', '1', ' orientation="under"')),
      ),
    )

    expect(events[0]?.slurs[0]?.side).toBe('up')
    expect(events[0]?.slurs[0]?.sideEnd).toBe('down')
  })

  test('leaves sideEnd unsaid where the stop restates the side of the start', () => {
    const { events, warnings } = read(
      measures(
        DIVISIONS +
          note('C', slur('start', '1', ' orientation="over"')) +
          note('G', slur('stop', '1', ' orientation="over"')),
      ),
    )

    expect(events[0]?.slurs[0]).toEqual({ target: events[1]?.id, side: 'up' })
    expect(warnings.map((w) => w.code)).not.toContain('unsupported:attribute')
  })

  // A "continue" edge marks a note partway along the slur. MNX states no
  // side there, so one the source writes is read and dropped rather than
  // reported as an unread attribute.
  test('passes over a side stated partway along the slur', () => {
    const { events, warnings } = read(
      measures(
        DIVISIONS +
          note('C', slur('start')) +
          note('D', slur('continue', '1', ' orientation="over" placement="above"')) +
          note('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.target).toBe(events[2]?.id)
    expect(warnings.map((w) => w.code)).not.toContain('unsupported:attribute')
  })

  test('writes both slur sides onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      measures(
        DIVISIONS +
          note('C', slur('start', '1', ' orientation="over"')) +
          note('G', slur('stop', '1', ' placement="below"')),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"side":"up"')
    expect(JSON.stringify(mnx)).toContain('"sideEnd":"down"')
  })

  test('reads the line type the slur is drawn with', () => {
    const { events } = read(
      measures(
        DIVISIONS + note('C', slur('start', '1', ' line-type="dashed"')) + note('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.lineType).toBe('dashed')
  })

  test('writes the slur line type onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      measures(
        DIVISIONS + note('C', slur('start', '1', ' line-type="dashed"')) + note('G', slur('stop')),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"lineType":"dashed"')
  })

  test('reports a slur the source never ends', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', slur('start')) + note('G')))

    expect(warnings.map((w) => w.code)).toContain('unclosed:spanner')
  })

  // A slur may reach a measure-filling rest. The sequence-level full-measure
  // rest is not an event with an id, so a rest carrying a slur end stays a
  // plain event, as a rest with a lyric does, giving the slur a target.
  test('ends a slur on a measure-filling rest, which stays an event to carry it', () => {
    const fullRest =
      '<note><rest measure="yes"/><duration>4</duration><type>quarter</type><voice>1</voice>' +
      '<notations><slur type="stop" number="1"/></notations></note>'
    const { events, warnings } = read(measures(DIVISIONS + note('C', slur('start')), fullRest))
    const [first, rest] = events

    expect(rest?.isRest).toBe(true)
    expect(first?.slurs[0]?.target).toBe(rest?.id)
    expect(warnings).toEqual([])
  })

  test('writes the slur onto schema-valid MNX when it ends on a measure rest', () => {
    const fullRest =
      '<note><rest measure="yes"/><duration>4</duration><type>quarter</type><voice>1</voice>' +
      '<notations><slur type="stop" number="1"/></notations></note>'
    convertValid(measures(DIVISIONS + note('C', slur('start')), fullRest))
  })

  // The other endpoint, for the same reason: a slur beginning on the rest is
  // stated on the event it begins from, and the sequence-level rest is not one.
  test('starts a slur on a measure-filling rest, which stays an event to carry it', () => {
    const fullRest =
      '<note><rest measure="yes"/><duration>4</duration><type>quarter</type><voice>1</voice>' +
      '<notations><slur type="start" number="1"/></notations></note>'
    const { events, warnings } = read(measures(DIVISIONS + fullRest, note('G', slur('stop'))))
    const [rest, second] = events

    expect(rest?.isRest).toBe(true)
    expect(rest?.slurs[0]?.target).toBe(second?.id)
    expect(warnings).toEqual([])
  })

  // A slur only passing over the rest carries no endpoint, so it needs no event
  // to target. The rest keeps the sequence-level full-measure form.
  test('keeps the full-measure form when a slur only passes over the rest', () => {
    const contRest =
      '<note><rest measure="yes"/><duration>4</duration><type>quarter</type><voice>1</voice>' +
      '<notations><slur type="continue" number="1"/></notations></note>'
    const warnings = new WarningCollector()
    const score = readValid(
      measures(DIVISIONS + note('C', slur('start')), contRest, note('G', slur('stop'))),
      warnings,
    )
    const second = score.parts[0]?.measures[1]?.sequences[0]

    expect(second?.fullMeasure).toBeDefined()
    expect(second?.content).toEqual([])
  })
})

describe('the ends a spanner is keyed by', () => {
  // A tie routinely runs between voices, which MNX allows for with a
  // crossVoice target type, so the voice is not part of the match.
  test('joins a tie that runs from one voice into another', () => {
    const voiced = (step: string, voice: string, body: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>${voice}</voice>${body}</note>`
    const collector = new WarningCollector()
    readValid(
      measures(
        DIVISIONS +
          voiced('C', '1', tied('start')) +
          '<backup><duration>4</duration></backup>' +
          voiced('C', '2', tied('stop')),
      ),
      collector,
    )

    expect(collector.list().filter((w) => w.code === 'unclosed:spanner')).toEqual([])
  })

  // Two hands can each sustain the same pitch at once, so two ties of one
  // pitch are open together. Keyed by pitch alone, the second start would
  // overwrite the first. Each resolves to its own voice's note.
  test('joins two ties of the same pitch open at once in different voices', () => {
    const voiced = (voice: string, body: string) =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>${voice}</voice>${body}</note>`
    const backup = '<backup><duration>4</duration></backup>'
    const collector = new WarningCollector()
    const score = readValid(
      measures(
        DIVISIONS + voiced('1', tied('start')) + backup + voiced('2', tied('start')),
        voiced('1', tied('stop')) + backup + voiced('2', tied('stop')),
      ),
      collector,
    )

    const isEvent = (item: { kind: string }): item is Event => item.kind === 'event'
    const allNotes = (score.parts[0]?.measures ?? [])
      .flatMap((measure) => measure.sequences.flatMap((sequence) => sequence.content))
      .filter(isEvent)
      .flatMap((event) => event.notes)
    const withTie = allNotes.filter((note) => note.ties.length > 0)

    expect(collector.list().filter((w) => w.code === 'unclosed:spanner')).toEqual([])
    expect(withTie).toHaveLength(2)
    expect(withTie.every((note) => note.ties[0]?.crossVoice === false)).toBe(true)
  })

  // Sibelius leaves <voice> off the notes of a chord after the first.
  test('ties a chord member that names no voice from the voice of its chord', () => {
    const member =
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
      `<type>quarter</type>${tied('start')}</note>`
    const { notes, warnings } = read(
      measures(DIVISIONS + note('C') + member, note('E', tied('stop'))),
    )
    const [, e1, e2] = notes as [Note, Note, Note]

    expect(e1.ties).toEqual([{ target: e2.id, crossVoice: false }])
    expect(warnings).toEqual([])
  })

  test('tells apart ties of different pitch left open at once', () => {
    const { notes } = read(
      measures(
        DIVISIONS +
          note('C', tied('start')) +
          note('G', tied('start')) +
          note('G', tied('stop')) +
          note('C', tied('stop')),
      ),
    )
    const [c1, g1, g2, c2] = notes as [Note, Note, Note, Note]

    expect(c1.ties).toEqual([{ target: c2.id, crossVoice: false }])
    expect(g1.ties).toEqual([{ target: g2.id, crossVoice: false }])
  })

  // In piano writing a slur routinely runs from one hand to the other, which
  // is a different voice and a different staff, so the number is scoped to the
  // part, not the voice.
  test('joins a slur that runs from one voice into another', () => {
    const voiced = (step: string, voice: string, body: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>${voice}</voice>${body}</note>`
    const warnings = (() => {
      const collector = new WarningCollector()
      readValid(
        measures(
          DIVISIONS +
            voiced('C', '1', slur('start')) +
            '<backup><duration>4</duration></backup>' +
            voiced('G', '2', slur('stop')),
        ),
        collector,
      )
      return collector.list()
    })()

    expect(warnings.filter((w) => w.code === 'unclosed:spanner')).toEqual([])
  })

  // A slur cannot start and end on one note, so the stop closes the slur
  // opened before the note, whichever order the document writes the two in.
  test.each([
    ['one <notations>', `<notations><slur type="start"/><slur type="stop"/></notations>`],
    ['two <notations>', slur('start') + slur('stop')],
  ])('ends a slur and starts the next on a note writing the start first, in %s', (_, middle) => {
    const { events, warnings } = read(
      measures(DIVISIONS + note('C', slur('start')) + note('D', middle) + note('E', slur('stop'))),
    )
    const [first, second, third] = events as [Event, Event, Event]

    expect(first.slurs).toEqual([{ target: second.id, side: undefined }])
    expect(second.slurs).toEqual([{ target: third.id, side: undefined }])
    expect(warnings).toEqual([])
  })

  test('closes the most recently opened slur when two share a number', () => {
    const { events } = read(
      measures(
        DIVISIONS +
          note('C', slur('start')) +
          note('D', slur('start')) +
          note('E', slur('stop')) +
          note('F', slur('stop')),
      ),
    )
    const [outer, inner, first, second] = events as [Event, Event, Event, Event]

    // The inner slur closes first, the outer one second.
    expect(inner.slurs[0]?.target).toBe(first.id)
    expect(outer.slurs[0]?.target).toBe(second.id)
  })
})

describe('spanners on music that names no voice', () => {
  const bare = (step: string, body = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`

  test('joins a tie', () => {
    const { notes } = read(measures(DIVISIONS + bare('C', tied('start')) + bare('C', tied('stop'))))

    expect(notes[0]?.ties).toEqual([{ target: notes[1]?.id, crossVoice: false }])
  })

  test('joins a slur that states no number either', () => {
    const unnumbered = (type: string) => `<notations><slur type="${type}"/></notations>`
    const { events } = read(
      measures(DIVISIONS + bare('C', unnumbered('start')) + bare('G', unnumbered('stop'))),
    )

    expect(events[0]?.slurs[0]?.target).toBe(events[1]?.id)
  })

  test('reads a slur drawn above the notes', () => {
    const { events } = read(
      measures(
        DIVISIONS + bare('C', slur('start', '1', ' placement="above"')) + bare('G', slur('stop')),
      ),
    )

    expect(events[0]?.slurs[0]?.side).toBe('up')
  })
})

describe('spanner markings that are not simply a start or a stop', () => {
  test('passes over a slur marked as continuing, which MNX has no need of', () => {
    const { events, warnings } = read(
      measures(
        DIVISIONS +
          note('C', slur('start')) +
          note('D', slur('continue')) +
          note('E', slur('stop')),
      ),
    )

    expect(warnings).toEqual([])
    expect(events[0]?.slurs[0]?.target).toBe(events[2]?.id)
  })

  test('reports a slur it has no reading for', () => {
    const { warnings } = read(
      measures(DIVISIONS + note('C', '<notations><slur type="backward hook"/></notations>')),
    )

    expect(warnings.map((w) => w.message)).toContain(
      'A <slur> of type "backward hook" is not one MusicXML defines, and is not carried over.',
    )
  })

  test.each([
    ['tie', '<tie/>'],
    ['slur', '<notations><slur/></notations>'],
  ])('reports a %s that states no type at all', (kind, markup) => {
    const { warnings } = read(measures(DIVISIONS + note('C', markup)))

    expect(warnings.map((w) => [w.code, w.message])).toContainEqual([
      'missing:attribute',
      `A <${kind}> states no type, and is not carried over.`,
    ])
  })

  test('reads a let-ring <tie> as an lv tie', () => {
    const { notes, warnings } = read(measures(DIVISIONS + note('C', '<tie type="let-ring"/>')))

    expect(notes[0]?.ties).toEqual([{ crossVoice: false, lv: true }])
    // A let-ring is a type this reader has a reading for, so it is not one of
    // the types it reports.
    expect(warnings).toEqual([])
  })

  // MusicXML defines a tie's type as start or stop, so another is the
  // source's problem, not a gap in this converter.
  test('reports a tie type MusicXML does not define', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', '<tie type="bogus"/>')))

    expect(warnings.map((w) => [w.code, w.element, w.attribute, w.message])).toContainEqual([
      'unresolved:attribute-value',
      'tie',
      'type',
      'A <tie> of type "bogus" is not one MusicXML defines, and is not carried over.',
    ])
  })
})

// The stop of a span can cover a point earlier than where it is written, as
// an octave shift's stop covers the last event before it. The two ends can
// interleave through a backup or forward so that the stop sits past the start
// while the point it covers falls before it; joined, the span would end
// before it starts.
// An unclosed end is reported once the part is whole, at the element it is
// written with.
describe('where an end with nothing to join is reported', () => {
  test.each([
    ['a <tie>', 'tie', '\n<tie type="stop"/>\n<notations><tied type="stop"/></notations>'],
    ['a <tied> with no <tie>', 'tied', '\n<notations>\n<tied type="stop"/></notations>'],
    ['a <slur>', 'slur', '\n<notations>\n<slur type="stop"/></notations>'],
  ])('reports %s at its own line', (_what, element, body) => {
    const source = measures(DIVISIONS + note('C', body))
    const { warnings } = read(source)

    const line = source.split('\n').findIndex((text) => text.includes(`<${element} `)) + 1
    expect(warnings.map((w) => [w.code, w.element, w.context.line])).toEqual([
      ['unclosed:spanner', element, line],
    ])
  })
})

describe('pairing the two ends of a span', () => {
  const spanEnd = (
    kind: 'start' | 'stop',
    position: Fraction,
    covers: Fraction,
  ): SpanEnd<string, undefined> => {
    const place = { number: '1', measure: 0, position, covers, where: WRITTEN }
    return kind === 'start'
      ? { ...place, kind, payload: 'span' }
      : { ...place, kind, stop: undefined }
  }

  test('reports a stop covering a point before its start instead of joining it', () => {
    const joined: string[] = []
    const reported: string[] = []

    pairSpans<string, undefined>(
      [
        spanEnd('start', fraction(3, 4), fraction(3, 4)),
        spanEnd('stop', fraction(7, 8), fraction(0)),
      ],
      (payload) => joined.push(payload),
      (reason) => reported.push(reason),
    )

    expect(joined).toEqual([])
    expect(reported).toEqual(['backwards-stop'])
  })

  test('joins a stop covering the very point where its start sits', () => {
    const joined: string[] = []
    const reported: string[] = []

    pairSpans<string, undefined>(
      [
        spanEnd('start', fraction(3, 4), fraction(3, 4)),
        spanEnd('stop', fraction(7, 8), fraction(3, 4)),
      ],
      (payload) => joined.push(payload),
      (reason) => reported.push(reason),
    )

    expect(joined).toEqual(['span'])
    expect(reported).toEqual([])
  })

  // The point a stop covers falls before its start only where the two are in
  // one measure. A stop in a later measure covering the first beat of it is
  // an ordinary span across a barline, which is most of them.
  test('joins a stop in a later measure covering a point before its start', () => {
    const joined: string[] = []
    const reported: string[] = []
    const start = { ...spanEnd('start', fraction(3, 4), fraction(3, 4)), measure: 0 }
    const stop = { ...spanEnd('stop', fraction(0), fraction(0)), measure: 1 }

    pairSpans<string, undefined>(
      [start, stop],
      (payload) => joined.push(payload),
      (reason) => reported.push(reason),
    )

    expect(joined).toEqual(['span'])
    expect(reported).toEqual([])
  })
})

// Whether a voice's slurs of one number are that voice's own, and what a
// measure of them leaves over, decide whether the voice keeps its own pairing
// or joins the pass across the part. Through a whole score, a wrong answer
// mostly reaches the same joins, because the pass hands back what it cannot
// pair and prefers a stop's own voice. These tests ask each question directly.
describe('whether a voice accounts for its own slurs', () => {
  // A start carries the slur it opens and a stop names the event it ends on.
  // Neither answer below reads either one, so one bare event stands for both.
  const event: Event = {
    kind: 'event',
    id: 'ev',
    staff: undefined,
    value: { base: 'quarter', dots: 0 },
    slurs: [],
    lyrics: new Map(),
    stemDirection: undefined,
    markings: {},
    fermata: undefined,
    notes: [],
    kitNotes: [],
    isRest: false,
    staffPosition: undefined,
  }

  const slurEnd = (kind: 'start' | 'stop', index: number): SlurEnd => {
    const place = {
      number: '1',
      measure: 0,
      position: fraction(index, 4),
      covers: fraction(index, 4),
      where: WRITTEN,
    }
    return kind === 'start'
      ? { ...place, kind, payload: { event, side: undefined, lineType: undefined } }
      : { ...place, kind, stop: { event, sideEnd: undefined } }
  }

  const stream = (...kinds: readonly ('start' | 'stop')[]) =>
    kinds.map((kind, index) => slurEnd(kind, index))

  test.each([
    ['one slur opened and closed', ['start', 'stop'], true],
    ['two slurs one after the other', ['start', 'stop', 'start', 'stop'], true],
    ['nothing at all', [], true],
    ['a slur left open', ['start'], false],
    ['a stop with nothing open', ['stop'], false],
    ['a stop before the start', ['stop', 'start'], false],
    // Two slurs of one number open at once say nothing about which stop
    // closes which, so the voice is not accounting for them either.
    ['two slurs of one number open at once', ['start', 'start', 'stop', 'stop'], false],
  ] as const)('reads %s as %s', (_what, kinds, own) => {
    expect(accountsForItself(stream(...kinds))).toBe(own)
  })

  // What one measure of one voice leaves over, which another voice's pair is
  // compared with: a start over on one side, a stop over on the other.
  test.each([
    ['nothing over', ['start', 'stop'], 'none'],
    ['a start over', ['start'], 'unclosed'],
    ['a stop over', ['stop'], 'orphan'],
    ['one of each', ['stop', 'start'], 'both'],
    ['two starts over', ['start', 'start'], 'unclosed'],
    ['two stops over', ['stop', 'stop'], 'orphan'],
    ['a slur closed and a stop over', ['start', 'stop', 'stop'], 'orphan'],
  ] as const)('leaves %s', (_what, kinds, residue) => {
    expect(measureResidue(stream(...kinds))).toBe(residue)
  })
})

// Which end is read first decides which start a stop closes. Each test below
// states one comparator rule by the outcome it produces.
describe('the order the ends of a span are read in', () => {
  const end = (
    kind: 'start' | 'stop',
    measure: number,
    position: Fraction,
    payload = 'span',
    grace?: boolean,
  ): SpanEnd<string, undefined> => {
    const place = {
      number: '1',
      measure,
      position,
      covers: position,
      where: WRITTEN,
      ...(grace === undefined ? {} : { grace }),
    }
    return kind === 'start' ? { ...place, kind, payload } : { ...place, kind, stop: undefined }
  }

  function pair(
    ends: readonly SpanEnd<string, undefined>[],
    atSamePoint?: 'stop-first' | 'as-written',
  ) {
    const joined: string[] = []
    const reported: string[] = []
    pairSpans<string, undefined>(
      ends,
      (payload) => joined.push(payload),
      (reason) => reported.push(reason),
      atSamePoint,
    )
    return { joined, reported }
  }

  // Two ends alike in every way the comparator checks are separated by the
  // order the document writes them in, and by nothing else. Two spans of one
  // number opening at one point stack, so which of them a later stop closes
  // is that order's to decide.
  test('keeps two starts at one point in the order the document writes them', () => {
    const { joined, reported } = pair([
      end('start', 1, fraction(0), 'first'),
      end('start', 1, fraction(0), 'second'),
      end('stop', 1, fraction(1, 4)),
      end('stop', 1, fraction(1, 2)),
    ])

    // A stop closes the most recently opened span, so the second one written
    // is the one the earlier stop closes.
    expect(joined).toEqual(['second', 'first'])
    expect(reported).toEqual([])
  })

  // The measure comes first, before anything inside it. The ends are handed
  // over out of order here, which the reader does not do, to test the
  // comparator on its own.
  test('reads an earlier measure before a later one, whatever order they arrive in', () => {
    expect(pair([end('stop', 3, fraction(0)), end('start', 1, fraction(0))])).toEqual({
      joined: ['span'],
      reported: [],
    })
  })

  // A grace note sounds before the beat, so its end comes first however the
  // document writes the two. Either order of writing, since another voice can
  // write the beat note's end ahead of the grace note that opens it.
  test.each([
    ['the grace end written first', true],
    ['the grace end written second', false],
  ])('reads a grace end before a beat end at the same point, with %s', (_what, graceFirst) => {
    const grace = end('start', 0, fraction(1, 4), 'span', true)
    const beat = end('stop', 0, fraction(1, 4), 'span', false)

    expect(pair(graceFirst ? [grace, beat] : [beat, grace], 'as-written')).toEqual({
      joined: ['span'],
      reported: [],
    })
  })

  // The same rule read through the reader, which is where the flag is set. A
  // note joining the chord before it is not a grace note, whatever the chord
  // is: its tie is a beat end, so a grace end at the same point in another
  // voice is read first and closes nothing.
  test('reads a grace end before the end a chord member carries', () => {
    const { warnings } = readAllVoices(
      measures(
        DIVISIONS +
          note('E') +
          '<note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          `<type>quarter</type><voice>1</voice>${tied('start')}</note>` +
          '<backup><duration>4</duration></backup>' +
          '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>eighth</type>' +
          `<voice>2</voice>${tied('stop')}</note>` +
          note('G', '', '2'),
      ),
    )

    expect(warnings.map((one) => one.message)).toEqual([
      'A tie ends on a note where none had started, and is not carried over.',
      'A tie starts on a note that nothing ties to, and is not carried over.',
    ])
  })

  // Under stop-first a stop at the same point as a start closes what was open
  // before it rather than that start: an octave shift's stop covers the last
  // event before it, which is the event the next shift starts on.
  test('reads a stop before a start at the same point where the caller asks for it', () => {
    expect(pair([end('start', 0, fraction(1, 2)), end('stop', 0, fraction(1, 2))])).toEqual({
      joined: [],
      reported: ['orphan-stop', 'unclosed-start'],
    })
  })

  // Asked for the document's own order instead, the same two ends pair.
  test('reads them as written where the caller asks for that', () => {
    expect(
      pair([end('start', 0, fraction(1, 2)), end('stop', 0, fraction(1, 2))], 'as-written'),
    ).toEqual({ joined: ['span'], reported: [] })
  })

  // Reading a stop before a start is a rule about the two kinds. Two stops at
  // one point are not parted by it, so they close in the order they were
  // written: the first closes the last start opened, as any stop does.
  test('keeps two stops at one point in the order they were written', () => {
    const joined: string[] = []
    pairSpans<string, undefined>(
      [
        end('start', 0, fraction(0), 'first'),
        end('start', 0, fraction(1, 4), 'second'),
        { ...end('stop', 0, fraction(1, 2)), covers: fraction(1, 2) },
        { ...end('stop', 0, fraction(1, 2)), covers: fraction(3, 8) },
      ],
      (payload, stop) => joined.push(`${payload} covering ${String(stop.covers.den)}`),
      () => undefined,
    )

    expect(joined).toEqual(['second covering 2', 'first covering 8'])
  })

  // Two ends a rule cannot part keep the order the document wrote them in, so
  // a stop closes the later of two starts written at one point.
  test('keeps two ends of one kind at one point in the order they were written', () => {
    expect(
      pair([
        end('start', 0, fraction(0), 'first'),
        end('start', 0, fraction(0), 'second'),
        end('stop', 0, fraction(1, 2)),
      ]),
    ).toEqual({ joined: ['second'], reported: ['unclosed-start'] })
  })
})

describe('ids', () => {
  test('gives every event and note a distinct one', () => {
    const { events, notes } = read(measures(DIVISIONS + note('C') + note('G')))
    const all = [...events.map((e) => e.id), ...notes.map((n) => n.id)]

    expect(new Set(all).size).toBe(all.length)
  })
})
