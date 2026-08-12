// MusicXML marks a tie or a slur at both ends and leaves the connection
// implied. MNX states it once, on the note or event where it begins, as a
// reference to the one where it ends. Resolving that means holding the open
// ends until their partner turns up, which can be several measures later.

import { describe, expect, test } from 'vitest'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { pairSpans } from './spanners.js'
import type { SpanEnd } from './spanners.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'
import type { Event, Note } from '../model/score.js'

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
  const score = readScore(parseXmlRoot(source), warnings)
  const events = (score.parts[0]?.measures ?? []).flatMap(
    (measure) =>
      measure.sequences[0]?.content.filter((item): item is Event => item.kind === 'event') ?? [],
  )
  return { events, notes: events.flatMap((event) => event.notes), warnings: warnings.list() }
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
})

// <tied> is the visual side of a tie. Most of it repeats <tie>, but let-ring
// and the drawn side live only there, so the reader must read it rather than
// skip it.
describe('let-ring and the drawn side', () => {
  test('reads a let-ring <tied> as an lv tie with no target', () => {
    const { notes } = read(
      measures(DIVISIONS + note('C', '<notations><tied type="let-ring"/></notations>')),
    )

    expect(notes[0]?.ties).toEqual([{ crossVoice: false, lv: true }])
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

  test('writes let-ring and side onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx } = convertMusicXML(
      measures(
        DIVISIONS +
          note('C', slur('start', '1', ' orientation="over"')) +
          note('G', slur('stop', '1', ' placement="below"')),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"side":"up"')
    expect(JSON.stringify(mnx)).toContain('"sideEnd":"down"')
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx } = convertMusicXML(
      measures(
        DIVISIONS + note('C', slur('start', '1', ' line-type="dashed"')) + note('G', slur('stop')),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"lineType":"dashed"')
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('reports a slur the source never ends', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', slur('start')) + note('G')))

    expect(warnings.map((w) => w.code)).toContain('unclosed:spanner')
  })

  // A slur may reach a measure-filling rest. The sequence-level full-measure
  // rest is not an event with an id, so a rest carrying a slur end stays a
  // plain event, exactly as a lyric-bearing one does, giving the slur a target.
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
    const { mnx } = convertMusicXML(measures(DIVISIONS + note('C', slur('start')), fullRest))

    expect(schemaErrors(mnx)).toEqual([])
  })

  // A slur only passing over the rest carries no endpoint, so it needs no event
  // to target. The rest keeps the sequence-level full-measure form.
  test('keeps the full-measure form when a slur only passes over the rest', () => {
    const contRest =
      '<note><rest measure="yes"/><duration>4</duration><type>quarter</type><voice>1</voice>' +
      '<notations><slur type="continue" number="1"/></notations></note>'
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        measures(DIVISIONS + note('C', slur('start')), contRest, note('G', slur('stop'))),
      ),
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
    readScore(
      parseXmlRoot(
        measures(
          DIVISIONS +
            voiced('C', '1', tied('start')) +
            '<backup><duration>4</duration></backup>' +
            voiced('C', '2', tied('stop')),
        ),
      ),
      collector,
    )

    expect(collector.list().filter((w) => w.code === 'unclosed:spanner')).toEqual([])
  })

  // Two hands can each sustain the same pitch at once, so two ties of one
  // pitch are open together. Keyed by pitch alone, the second start used to
  // overwrite the first, dropping it with no warning. Each must resolve, and
  // to its own voice's note rather than the other hand's.
  test('joins two ties of the same pitch open at once in different voices', () => {
    const voiced = (voice: string, body: string) =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>${voice}</voice>${body}</note>`
    const backup = '<backup><duration>4</duration></backup>'
    const collector = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        measures(
          DIVISIONS + voiced('1', tied('start')) + backup + voiced('2', tied('start')),
          voiced('1', tied('stop')) + backup + voiced('2', tied('stop')),
        ),
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
  // is a different voice and a different staff. Scoping the number to a voice
  // breaks every one of those, so it is scoped to the part.
  test('joins a slur that runs from one voice into another', () => {
    const voiced = (step: string, voice: string, body: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type><voice>${voice}</voice>${body}</note>`
    const warnings = (() => {
      const collector = new WarningCollector()
      readScore(
        parseXmlRoot(
          measures(
            DIVISIONS +
              voiced('C', '1', slur('start')) +
              '<backup><duration>4</duration></backup>' +
              voiced('G', '2', slur('stop')),
          ),
        ),
        collector,
      )
      return collector.list()
    })()

    expect(warnings.filter((w) => w.code === 'unclosed:spanner')).toEqual([])
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
      'A <slur> of type "backward hook" is not converted yet.',
    )
  })

  test.each([
    ['tie', '<tie/>'],
    ['slur', '<notations><slur/></notations>'],
  ])('reports a %s that states no type at all', (kind, markup) => {
    const { warnings } = read(measures(DIVISIONS + note('C', markup)))

    expect(warnings.map((w) => w.message)).toContain(`A <${kind}> of type "" is not converted yet.`)
  })

  test('reads a let-ring <tie> as an lv tie', () => {
    const { notes } = read(measures(DIVISIONS + note('C', '<tie type="let-ring"/>')))

    expect(notes[0]?.ties).toEqual([{ crossVoice: false, lv: true }])
  })

  test('reports a tie type it has no reading for', () => {
    const { warnings } = read(measures(DIVISIONS + note('C', '<tie type="bogus"/>')))

    expect(warnings.map((w) => w.message)).toContain(
      'A <tie> of type "bogus" is not converted yet.',
    )
  })
})

// The stop of a span can cover a point earlier than where it is written, as
// an octave shift's stop covers the last event before it. The two ends can
// interleave through a backup or forward so that the stop sits past the start
// while the point it covers falls before it; joined, the span would end
// before it starts.
describe('pairing the two ends of a span', () => {
  const spanEnd = (
    kind: 'start' | 'stop',
    position: Fraction,
    covers: Fraction,
  ): SpanEnd<string> => ({
    kind,
    number: '1',
    measure: 0,
    position,
    covers,
    payload: kind === 'start' ? 'span' : undefined,
    context: {},
  })

  test('reports a stop covering a point before its start instead of joining it', () => {
    const joined: string[] = []
    const reported: string[] = []

    pairSpans(
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

    pairSpans(
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
})

describe('ids', () => {
  test('gives every event and note a distinct one', () => {
    const { events, notes } = read(measures(DIVISIONS + note('C') + note('G')))
    const all = [...events.map((e) => e.id), ...notes.map((n) => n.id)]

    expect(new Set(all).size).toBe(all.length)
  })
})
