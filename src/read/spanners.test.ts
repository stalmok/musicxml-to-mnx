// MusicXML marks a tie or a slur at both ends and leaves the connection
// implied. MNX states it once, on the note or event where it begins, as a
// reference to the one where it ends. Resolving that means holding the open
// ends until their partner turns up, which can be several measures later.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
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

describe('ids', () => {
  test('gives every event and note a distinct one', () => {
    const { events, notes } = read(measures(DIVISIONS + note('C') + note('G')))
    const all = [...events.map((e) => e.id), ...notes.map((n) => n.id)]

    expect(new Set(all).size).toBe(all.length)
  })
})
