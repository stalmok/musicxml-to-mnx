// The marks written on a note: how it is attacked, and how long it is held.
// MusicXML files them under <articulations> inside <notations>; MNX states
// them as a set keyed by name on the event, so a note carries at most one of
// each and the order the source wrote them in says nothing.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import type { Event } from '../model/score.js'

function read(body: string) {
  const warnings = new WarningCollector()
  const score = readScore(
    parseXmlRoot(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
    ),
    warnings,
  )
  const content = score.parts[0]?.measures[0]?.sequences[0]?.content ?? []
  const events = content.filter((item): item is Event => item.kind === 'event')
  return { events, warnings: warnings.list() }
}

function note(notations = '', extra = ''): string {
  return (
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>quarter</type>${extra}${notations ? `<notations>${notations}</notations>` : ''}</note>`
  )
}

const articulations = (inner: string) => `<articulations>${inner}</articulations>`

describe('articulations', () => {
  test('reads each mark under the name MNX gives it', () => {
    const { events, warnings } = read(
      note(
        articulations(
          '<accent/><staccato/><staccatissimo/><tenuto/><spiccato/>' +
            '<stress/><unstress/><soft-accent/>',
        ),
      ),
    )

    expect(events[0]?.markings.map((m) => m.kind)).toEqual([
      'accent',
      'staccato',
      'staccatissimo',
      'tenuto',
      'spiccato',
      'stress',
      'unstress',
      'softAccent',
    ])
    expect(warnings).toEqual([])
  })

  test('keeps which side of the notes a mark is drawn on', () => {
    const { events } = read(note(articulations('<accent placement="above"/>')))

    expect(events[0]?.markings[0]?.orient).toBe('above')
  })

  test('leaves the side unset where the source does not say', () => {
    const { events } = read(note(articulations('<accent/>')))

    expect(events[0]?.markings[0]?.orient).toBeUndefined()
  })

  test('keeps which way a strong accent points', () => {
    const { events } = read(note(articulations('<strong-accent type="down"/>')))

    expect(events[0]?.markings[0]).toMatchObject({ kind: 'strongAccent', pointing: 'down' })
  })

  // MusicXML's strong-accent type says which way the wedge points, and allows
  // values MNX's up-or-down has no room for.
  test('states no pointing for a strong accent that does not say which way', () => {
    const { events } = read(note(articulations('<strong-accent/>')))

    expect(events[0]?.markings[0]).toMatchObject({ kind: 'strongAccent', pointing: undefined })
  })

  // MusicXML files a breath mark among the articulations, and names its glyph
  // as the element's text. MNX states it beside them, under its own name.
  test('reads a breath mark and the glyph it is drawn with', () => {
    const { events } = read(note(articulations('<breath-mark>comma</breath-mark>')))

    expect(events[0]?.markings[0]).toMatchObject({ kind: 'breath', symbol: 'comma' })
  })

  test('states no glyph for a breath mark that names none', () => {
    const { events } = read(note(articulations('<breath-mark/>')))

    expect(events[0]?.markings[0]?.symbol).toBeUndefined()
  })

  // Every one of these is a real articulation MNX has no place for.
  test('reports the marks event-markings has no room for', () => {
    const { events, warnings } = read(
      note(articulations('<caesura/><detached-legato/><doit/><falloff/>')),
    )

    expect(events[0]?.markings).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual([
      'caesura',
      'detached-legato',
      'doit',
      'falloff',
    ])
  })

  // Exporters put a tie in one <notations> and an articulation in another.
  test('reads marks from every <notations> block', () => {
    const { events } = read(
      note(`${articulations('<accent/>')}</notations><notations>${articulations('<staccato/>')}`),
    )

    expect(events[0]?.markings.map((m) => m.kind).sort()).toEqual(['accent', 'staccato'])
  })

  test('reads them on a grace note too', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>4</divisions></attributes>' +
          '<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>' +
          `<notations>${articulations('<staccato/>')}</notations></note>` +
          note() +
          '</measure></part></score-partwise>',
      ),
      warnings,
    )

    const group = score.parts[0]?.measures[0]?.sequences[0]?.content[0]
    expect(group?.kind).toBe('grace')
    expect(group?.kind === 'grace' ? group.content[0]?.markings.map((m) => m.kind) : []).toEqual([
      'staccato',
    ])
    expect(warnings.list()).toEqual([])
  })
})

// A pause held over a note. MusicXML names its shape as the element's text
// and which way it faces as its type; MNX states both on the event.
describe('fermatas', () => {
  test('reads one that says only that it is there', () => {
    const { events, warnings } = read(note('<fermata/>'))

    expect(events[0]?.fermata).toEqual({
      symbol: undefined,
      pointing: undefined,
      orient: undefined,
    })
    expect(warnings).toEqual([])
  })

  test('reads which way it faces and which side it is drawn on', () => {
    const { events } = read(note('<fermata type="inverted" placement="below"/>'))

    expect(events[0]?.fermata).toMatchObject({ pointing: 'down', orient: 'below' })
  })

  test('reads an upright one as pointing up', () => {
    const { events } = read(note('<fermata type="upright"/>'))

    expect(events[0]?.fermata?.pointing).toBe('up')
  })

  test.each([
    ['normal', 'normal'],
    ['angled', 'angled'],
    ['square', 'square'],
    ['double-angled', 'doubleAngled'],
    ['double-square', 'doubleSquare'],
    ['double-dot', 'doubleDot'],
    ['half-curve', 'halfCurve'],
    ['curlew', 'curlew'],
  ])('reads the "%s" shape as MNX spells it', (written, expected) => {
    const { events, warnings } = read(note(`<fermata>${written}</fermata>`))

    expect(events[0]?.fermata?.symbol).toBe(expected)
    expect(warnings).toEqual([])
  })

  test('reports a shape MNX has no symbol for, keeping the fermata', () => {
    const { events, warnings } = read(note('<fermata>wibble</fermata>'))

    expect(events[0]?.fermata?.symbol).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['fermata'])
  })

  // MusicXML allows one per staff of a part; MNX states one per event.
  test('reports an event carrying more than one, keeping the first', () => {
    const { events, warnings } = read(note('<fermata type="upright"/><fermata type="inverted"/>'))

    expect(events[0]?.fermata?.pointing).toBe('up')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:fermata'])
  })

  test('states none where the note carries none', () => {
    const { events } = read(note())

    expect(events[0]?.fermata).toBeUndefined()
  })
})
