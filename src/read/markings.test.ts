// The marks written on a note: how it is attacked, and how long it is held.
// MusicXML files them under <articulations> inside <notations>; MNX states
// them as a set keyed by name on the event, so a note carries at most one of
// each and the order the source wrote them in says nothing.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
import type { Event } from '../model/score.js'

function read(body: string) {
  const warnings = new WarningCollector()
  const score = readValid(
    '<score-partwise><part id="P1"><measure number="1">' +
      `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
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

    expect(Object.keys(events[0]?.markings ?? {}).sort()).toEqual([
      'accent',
      'softAccent',
      'spiccato',
      'staccatissimo',
      'staccato',
      'stress',
      'tenuto',
      'unstress',
    ])
    expect(warnings).toEqual([])
  })

  test('keeps which side of the notes a mark is drawn on', () => {
    const { events } = read(note(articulations('<accent placement="above"/>')))

    expect(events[0]?.markings.accent?.placement).toBe('above')
  })

  test('leaves the side unset where the source does not say', () => {
    const { events } = read(note(articulations('<accent/>')))

    expect(events[0]?.markings.accent?.placement).toBeUndefined()
  })

  test('keeps which way a strong accent points', () => {
    const { events } = read(note(articulations('<strong-accent type="down"/>')))

    expect(events[0]?.markings.strongAccent).toEqual({ placement: undefined, pointing: 'down' })
  })

  // MusicXML's strong-accent type says which way the wedge points, and allows
  // values MNX's up-or-down has no room for.
  test('states no pointing for a strong accent that does not say which way', () => {
    const { events } = read(note(articulations('<strong-accent/>')))

    expect(events[0]?.markings.strongAccent).toEqual({ placement: undefined, pointing: undefined })
  })

  // MusicXML files a breath mark among the articulations, and names its glyph
  // as the element's text. MNX states it beside them, under its own name.
  test('reads a breath mark and the glyph it is drawn with', () => {
    const { events } = read(note(articulations('<breath-mark>comma</breath-mark>')))

    expect(events[0]?.markings.breath).toEqual({ placement: undefined, symbol: 'comma' })
  })

  test('states no glyph for a breath mark that names none', () => {
    const { events } = read(note(articulations('<breath-mark/>')))

    expect(events[0]?.markings.breath?.symbol).toBeUndefined()
  })

  test('reports the marks event-markings has no room for', () => {
    const { events, warnings } = read(note(articulations('<detached-legato/><doit/><falloff/>')))

    expect(events[0]?.markings).toEqual({})
    expect(warnings.map((w) => w.element)).toEqual(['detached-legato', 'doit', 'falloff'])
  })

  // Exporters put a tie in one <notations> and an articulation in another.
  test('reads marks from every <notations> block', () => {
    const { events } = read(
      note(`${articulations('<accent/>')}</notations><notations>${articulations('<staccato/>')}`),
    )

    expect(Object.keys(events[0]?.markings ?? {}).sort()).toEqual(['accent', 'staccato'])
  })

  test('reads them on a grace note too', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        '<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>' +
        `<notations>${articulations('<staccato/>')}</notations></note>` +
        note() +
        '</measure></part></score-partwise>',
      warnings,
    )

    const group = score.parts[0]?.measures[0]?.sequences[0]?.content[0]
    expect(group?.kind).toBe('grace')
    expect(group?.kind === 'grace' ? Object.keys(group.content[0]?.markings ?? {}) : []).toEqual([
      'staccato',
    ])
    expect(warnings.list()).toEqual([])
  })
})

// MusicXML files the bow marks under <technical> rather than among the
// articulations; MNX states one bowDirection beside the rest of the marks.
describe('bow direction', () => {
  const technical = (inner: string) => `<technical>${inner}</technical>`

  test.each([
    ['up-bow', 'up'],
    ['down-bow', 'down'],
  ])('reads <%s> as travelling %s', (written, direction) => {
    const { events, warnings } = read(note(technical(`<${written}/>`)))

    expect(events[0]?.markings.bowDirection).toEqual({ placement: undefined, direction })
    expect(warnings).toEqual([])
  })

  test('keeps which side of the notes the mark is drawn on', () => {
    const { events } = read(note(technical('<up-bow placement="below"/>')))

    expect(events[0]?.markings.bowDirection?.placement).toBe('below')
  })

  // MNX states one bow direction. Where a note states both, document order
  // decides.
  test.each([
    ['<up-bow/><down-bow placement="above"/>', 'up', 'down-bow'],
    ['<down-bow/><up-bow placement="above"/>', 'down', 'up-bow'],
  ])('reports a note carrying both bow marks, keeping the first', (inner, kept, reported) => {
    const { events, warnings } = read(note(technical(inner)))

    expect(events[0]?.markings.bowDirection?.direction).toBe(kept)
    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:marking', reported],
    ])
    expect(warnings[0]?.message).toBe(
      'An event carries more than one bow mark, and MNX states one direction. ' +
        'The first is the one converted.',
    )
  })

  // The rest of <technical> is not converted.
  test('goes on reporting the other playing instructions beside it', () => {
    const { events, warnings } = read(
      note(technical('<up-bow/><harmonic/><fingering>3</fingering>')),
    )

    expect(events[0]?.markings.bowDirection?.direction).toBe('up')
    expect(warnings.map((w) => w.element)).toEqual(['harmonic', 'fingering'])
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
      placement: undefined,
    })
    expect(warnings).toEqual([])
  })

  test('reads which way it faces and which side it is drawn on', () => {
    const { events } = read(note('<fermata type="inverted" placement="below"/>'))

    expect(events[0]?.fermata).toMatchObject({ pointing: 'down', placement: 'below' })
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
    expect(warnings.map((w) => [w.element, w.context.measure])).toEqual([['fermata', 1]])
  })

  // MusicXML allows one per staff of a part, and MNX states one per event.
  // The one warning covers the whole rejected mark, so its facing and side
  // are not reported again.
  test('reports an event carrying more than one, keeping the first', () => {
    const { events, warnings } = read(
      note('<fermata type="upright"/><fermata type="inverted" placement="below"/>'),
    )

    expect(events[0]?.fermata?.pointing).toBe('up')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:fermata'])
  })

  test('states none where the note carries none', () => {
    const { events } = read(note())

    expect(events[0]?.fermata).toBeUndefined()
  })
})

// MNX keys the marks on an event by name, so a second of the same kind has
// no home.
describe('two marks of one kind', () => {
  test('keeps the first and reports the rest', () => {
    const { events, warnings } = read(
      note(articulations('<accent placement="above"/><accent placement="below"/>')),
    )

    expect(events[0]?.markings.accent?.placement).toBe('above')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:marking'])
    expect(warnings[0]?.message).toBe(
      'An event carries more than one <accent>, and MNX states one of each kind. ' +
        'The first is the one converted.',
    )
  })

  // The one warning covers the second mark whole, so an attribute of its own
  // is not reported beside it.
  test('says nothing more about any attribute of the mark it rejects', () => {
    const { warnings } = read(
      note(articulations('<accent/><accent color="#FF0000" placement="below"/>')),
    )

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unrepresentable:marking', undefined],
    ])
  })

  test('says nothing more about the side and the facing of the mark it rejects', () => {
    const { warnings } = read(
      note(
        articulations(
          '<strong-accent type="up" placement="above"/>' +
            '<strong-accent type="down" placement="below"/>',
        ),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:marking'])
  })
})

// Most fermatas sit over a rest that fills the measure. MNX states that rest
// on the sequence, not as an event.
describe('a fermata over a rest filling the measure', () => {
  test('states it on the rest', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        '<note><rest measure="yes"/><duration>16</duration>' +
        '<notations><fermata type="upright"/></notations></note>' +
        '</measure></part></score-partwise>',
      warnings,
    )

    expect(score.parts[0]?.measures[0]?.sequences[0]?.fullMeasure?.fermata).toMatchObject({
      pointing: 'up',
    })
    expect(warnings.list()).toEqual([])
  })
})

describe('caesura', () => {
  const score = (inner: string) =>
    '<score-partwise><part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>' +
    '<part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>' +
    note(articulations(inner)) +
    '</measure></part></score-partwise>'
  const markingsOf = (mnx: ReturnType<typeof convertValid>['mnx']) => {
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    return item?.type === undefined ? item?.markings : undefined
  }

  test('writes a caesura with no shape as an empty caesura', () => {
    const { mnx, warnings } = convertValid(score('<caesura/>'))

    expect(markingsOf(mnx)).toEqual({ caesura: {} })
    expect(warnings).toEqual([])
  })

  test.each(['normal', 'thick', 'short', 'curved'])('reads a %s caesura as its shape', (shape) => {
    const { events, warnings } = read(note(articulations(`<caesura>${shape}</caesura>`)))

    expect(events[0]?.markings.caesura).toEqual({ marks: undefined, shape })
    expect(warnings).toEqual([])
  })

  // MNX draws two strokes unless told otherwise.
  test('writes a single caesura as one stroke', () => {
    const { mnx, warnings } = convertValid(score('<caesura>single</caesura>'))

    expect(markingsOf(mnx)).toEqual({ caesura: { marks: 1 } })
    expect(warnings).toEqual([])
  })

  test('writes the shape of a curved caesura', () => {
    const { mnx } = convertValid(score('<caesura>curved</caesura>'))

    expect(markingsOf(mnx)).toEqual({ caesura: { shape: 'curved' } })
  })

  test('reports a caesura shape it does not know and drops the caesura', () => {
    const { events, warnings } = read(
      note(articulations('<caesura placement="above">wiggly</caesura>')),
    )

    expect(events[0]?.markings.caesura).toBeUndefined()
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unsupported:element', 'caesura']])
    expect(warnings[0]?.message).toContain('wiggly')
    expect(warnings[0]?.context.measure).toBe(1)
  })

  // MNX's caesura states no side.
  test('reports the side a caesura is placed on', () => {
    const { events, warnings } = read(note(articulations('<caesura placement="above"/>')))

    expect(events[0]?.markings.caesura).toEqual({ marks: undefined, shape: undefined })
    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'placement'],
    ])
  })

  test('keeps the first of two caesuras and reports the second', () => {
    const { events, warnings } = read(
      note(articulations('<caesura>thick</caesura><caesura placement="above">short</caesura>')),
    )

    expect(events[0]?.markings.caesura).toEqual({ marks: undefined, shape: 'thick' })
    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:marking', 'caesura'],
    ])
    expect(warnings[0]?.context.measure).toBe(1)
  })
})

// Exporters write a mark on a chord by writing it on every note of it. MNX
// states the marks on the event, so the chord states each once.
describe('marks on the notes of a chord', () => {
  const member = (notations: string, sound = '<pitch><step>E</step><octave>4</octave></pitch>') =>
    `<note><chord/>${sound}<duration>4</duration><type>quarter</type>` +
    `<notations>${notations}</notations></note>`
  const chord = (first: string, other: string) => note(first) + member(other)
  const differs = (element: string) =>
    `A note of a chord carries a <${element}> another way than the note it joins. MNX ` +
    "states the marks on the event, and the chord's own are the ones converted."

  test.each([
    ['an articulation', articulations('<staccato placement="above"/>')],
    ['a strong accent', articulations('<strong-accent type="down"/>')],
    ['a breath mark', articulations('<breath-mark>comma</breath-mark>')],
    ['a caesura', articulations('<caesura>thick</caesura>')],
    ['a bow mark', '<technical><up-bow/></technical>'],
    ['a tremolo', '<ornaments><tremolo type="single">3</tremolo></ornaments>'],
  ])('reads %s every note carries as the chord’s own', (_, marks) => {
    const alone = read(note(marks)).events[0]?.markings
    const { events, warnings } = read(chord(marks, marks))

    expect(events[0]?.markings).toEqual(alone)
    expect(warnings).toEqual([])
  })

  // Each note's mark is drawn at its own place on the page.
  test('reads a mark the other note places elsewhere as the chord’s own', () => {
    const { warnings } = read(
      chord(articulations('<accent default-y="12"/>'), articulations('<accent default-y="-30"/>')),
    )

    expect(warnings).toEqual([])
  })

  // MusicXML gives each of these a value where the element leaves it out.
  test.each([
    ['a strong accent pointing up', '<strong-accent/>', '<strong-accent type="up"/>'],
    ['a normal caesura', '<caesura/>', '<caesura>normal</caesura>'],
  ])('reads %s the other note states outright', (_, first, other) => {
    expect(read(chord(articulations(first), articulations(other))).warnings).toEqual([])
  })

  test.each([
    ['on one note', '<tremolo>3</tremolo>', '<tremolo type="single">3</tremolo>'],
    ['with three beams', '<tremolo type="single"/>', '<tremolo type="single">3</tremolo>'],
    ['with a count written with a leading zero', '<tremolo>2</tremolo>', '<tremolo>02</tremolo>'],
    ['unmeasured', '<tremolo type="unmeasured"/>', '<tremolo type="unmeasured">0</tremolo>'],
  ])('reads a tremolo %s the other note states another way', (_, first, other) => {
    const { warnings } = read(
      chord(`<ornaments>${first}</ornaments>`, `<ornaments>${other}</ornaments>`),
    )

    expect(warnings).toEqual(read(note(`<ornaments>${first}</ornaments>`)).warnings)
  })

  test('reads a mark the other note writes with its attributes in another order', () => {
    const { warnings } = read(
      chord(
        articulations('<accent placement="above" color="#800000"/>'),
        articulations('<accent color="#800000" placement="above"/>'),
      ),
    )

    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['accent', 'color']])
  })

  test('writes the mark once', () => {
    const marks = articulations('<staccato/>')
    const { mnx, warnings } = convertValid(
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>x</part-name>' +
        '</score-part></part-list><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${chord(marks, marks)}` +
        '</measure></part></score-partwise>',
    )

    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    expect(item?.type === undefined ? item?.markings : undefined).toEqual({ staccato: {} })
    expect(warnings).toEqual([])
  })

  test('reads the mark from whichever <notations> block holds it', () => {
    const { warnings } = read(
      note(articulations('<accent/>')) +
        member(
          `<technical><fingering>2</fingering></technical></notations><notations>${articulations('<accent/>')}`,
        ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:element', 'fingering'],
    ])
  })

  test('reads the mark on a note of a kit chord', () => {
    const marks = articulations('<accent/>')
    const unpitched =
      '<unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>'
    const { events, warnings } = read(
      '<attributes><clef><sign>percussion</sign></clef></attributes>' +
        `<note>${unpitched}<duration>4</duration><type>quarter</type><notations>${marks}</notations></note>` +
        member(marks, unpitched.replace('C', 'E')),
    )

    expect(events[0]?.markings).toEqual({ accent: { placement: undefined } })
    expect(warnings).toEqual([])
  })

  test('reports a mark only the other note carries', () => {
    const { events, warnings } = read(chord('', articulations('<staccato placement="below"/>')))

    expect(events[0]?.markings).toEqual({})
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'inconsistent:marking',
        'staccato',
        'A note of a chord carries a <staccato> the note it joins does not. MNX states the ' +
          "marks on the event, and the chord's own are the ones converted.",
      ],
    ])
    expect(warnings[0]?.context.measure).toBe(1)
  })

  // The chord's own tremolo cannot be stated, so the chord carries none.
  test('reports a mark the other note carries where the chord’s own was not converted', () => {
    const { warnings } = read(
      chord(
        '<ornaments><tremolo type="single">9</tremolo></ornaments>',
        '<ornaments><tremolo type="single">3</tremolo></ornaments>',
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:element', 'tremolo'],
      ['inconsistent:marking', 'tremolo'],
    ])
  })

  test.each([
    [
      'draws on another side',
      articulations('<staccato placement="above"/>'),
      articulations('<staccato placement="below"/>'),
      'staccato',
    ],
    [
      'points another way',
      articulations('<strong-accent type="up"/>'),
      articulations('<strong-accent type="down" placement="above"/>'),
      'strong-accent',
    ],
    [
      'draws with another glyph',
      articulations('<breath-mark>comma</breath-mark>'),
      articulations('<breath-mark>tick</breath-mark>'),
      'breath-mark',
    ],
    [
      'draws with another shape',
      articulations('<caesura>thick</caesura>'),
      articulations('<caesura placement="above">short</caesura>'),
      'caesura',
    ],
    [
      'bows the other way',
      '<technical><up-bow/></technical>',
      '<technical><down-bow/></technical>',
      'down-bow',
    ],
  ])('reports a mark the other note %s', (_, first, other, element) => {
    const { events, warnings } = read(chord(first, other))

    expect(events[0]?.markings).toEqual(read(note(first)).events[0]?.markings)
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      ['inconsistent:marking', element, differs(element)],
    ])
  })

  test('reports a second of one kind on the other note', () => {
    const { warnings } = read(
      chord(
        articulations('<staccato/>'),
        `${articulations('<staccato/>')}</notations><notations>${articulations('<staccato/>')}`,
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:marking', 'staccato'],
    ])
  })

  test('says nothing of a second the chord’s own note carries', () => {
    const { warnings } = read(
      chord(articulations('<staccato/><staccato/>'), articulations('<staccato/>')),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:marking', 'staccato'],
    ])
  })

  test('reports what else the other note carries beside a restated mark', () => {
    const marks = articulations('<staccato/>')
    const { warnings } = read(
      chord(
        marks,
        articulations('<staccato/><doit/>') + '<technical><fingering>2</fingering></technical>',
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unsupported:element', 'doit'],
      ['unrepresentable:element', 'fingering'],
    ])
  })

  // MNX's caesura states no side. The chord's own note reports it, and a
  // note restating it loses nothing more.
  test('reports the side of a caesura every note carries once', () => {
    const caesura = articulations('<caesura placement="above"/>')
    const { warnings } = read(chord(caesura, caesura))

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'placement'],
    ])
  })

  test('reports a caesura the other note draws on another side', () => {
    const { warnings } = read(
      chord(
        articulations('<caesura placement="above"/>'),
        articulations('<caesura placement="below"/>'),
      ),
    )

    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:attribute', 'caesura', 'placement'],
      ['inconsistent:marking', 'caesura', undefined],
    ])
  })

  test.each([
    ['<tremolo type="single">9</tremolo>'],
    ['<tremolo type="unmeasured" placement="above"/>'],
  ])('reports %s every note carries once', (inner) => {
    const tremolo = `<ornaments>${inner}</ornaments>`
    const { warnings } = read(chord(tremolo, tremolo))

    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([
      ['unrepresentable:element', 'tremolo', 1],
    ])
  })
})

// MNX states the fermata on the event, and exporters write one over a chord
// by writing it on every note of it.
describe('a fermata on the notes of a chord', () => {
  const chord = (first: string, other: string) =>
    note(first) +
    '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>quarter</type><notations>${other}</notations></note>`

  test.each([
    ['one that says only that it is there', '<fermata/>'],
    ['a shaped one', '<fermata>angled</fermata>'],
    ['one facing down on a side', '<fermata type="inverted" placement="below">square</fermata>'],
  ])('reads %s every note carries as the chord’s own', (_, fermata) => {
    const { events, warnings } = read(chord(fermata, fermata))

    expect(events[0]?.fermata).toEqual(read(note(fermata)).events[0]?.fermata)
    expect(warnings).toEqual([])
  })

  // An empty <fermata> states no shape, which MNX reads as normal.
  test.each([
    ['<fermata/>', '<fermata>normal</fermata>'],
    ['<fermata>normal</fermata>', '<fermata/>'],
    // A fermata stating no type is upright.
    ['<fermata/>', '<fermata type="upright"/>'],
  ])('reads %s restated as %s', (first, other) => {
    expect(read(chord(first, other)).warnings).toEqual([])
  })

  test.each([
    ['only the other note carries', '', '<fermata/>'],
    ['the other note draws with another shape', '<fermata/>', '<fermata>square</fermata>'],
    ['the other note faces another way', '<fermata/>', '<fermata type="inverted"/>'],
    ['the other note draws on another side', '<fermata/>', '<fermata placement="below"/>'],
    ['the other note draws with a shape MNX lacks', '<fermata>x</fermata>', '<fermata>y</fermata>'],
  ])('reports a fermata %s', (_, first, other) => {
    const { events, warnings } = read(chord(first, other))
    const own = read(note(first))

    expect(events[0]?.fermata).toEqual(own.events[0]?.fermata)
    expect(warnings.slice(own.warnings.length).map((w) => [w.code, w.element])).toEqual([
      ['inconsistent:fermata', 'fermata'],
    ])
  })

  test('says how the other note’s fermata disagrees', () => {
    const { warnings } = read(chord('', '<fermata/>'))

    expect(warnings.map((w) => w.message)).toEqual([
      'A note of a chord carries a <fermata> the note it joins does not. MNX states the ' +
        "fermata once for the chord, and the chord's own is the one converted.",
    ])
  })

  test('reports a shape MNX lacks that every note carries once', () => {
    const fermata = '<fermata>x</fermata>'

    expect(read(chord(fermata, fermata)).warnings.map((w) => [w.code, w.element])).toEqual([
      ['unsupported:element', 'fermata'],
    ])
  })

  // MNX states one fermata on the event, so a second has no home on any note.
  const twoStaves = '<fermata type="upright"/><fermata type="inverted" placement="below"/>'
  test('reports a second fermata every note carries once, on the note the chord opens with', () => {
    const { events, warnings } = read(chord(twoStaves, twoStaves))

    expect(events[0]?.fermata).toMatchObject({ pointing: 'up' })
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'unrepresentable:fermata',
        'fermata',
        'More than one fermata is written at the same place, and MNX states one. ' +
          'The first is the one converted.',
      ],
    ])
  })

  test('reads a second fermata a note of a chord restates in a block of its own', () => {
    const other = twoStaves.replace('/><fermata', '/></notations><notations><fermata')

    expect(read(chord(twoStaves, other)).warnings.map((w) => w.code)).toEqual([
      'unrepresentable:fermata',
    ])
  })

  test.each([
    ['the note it joins carries one', '<fermata type="upright"/>', twoStaves],
    ['the note it joins carries another', twoStaves, '<fermata type="upright"/><fermata/>'],
    [
      'the note it joins carries fewer',
      twoStaves,
      twoStaves + '<fermata type="inverted" placement="below"/>',
    ],
    [
      'the note it joins carries another third',
      twoStaves + '<fermata>square</fermata>',
      twoStaves + '<fermata>angled</fermata>',
    ],
  ])('reports a second fermata on a note of a chord where %s', (_, first, other) => {
    const { events, warnings } = read(chord(first, other))
    const own = read(note(first))

    expect(events[0]?.fermata).toEqual(own.events[0]?.fermata)
    expect(
      warnings.slice(own.warnings.length).map((w) => [w.code, w.element, w.context.measure]),
    ).toEqual([['unrepresentable:fermata', 'fermata', 1]])
  })

  test('says the chord’s own first fermata is the one converted', () => {
    const { warnings } = read(chord('<fermata/>', twoStaves))

    expect(warnings.map((w) => w.message)).toEqual([
      'A note of a chord carries more than one fermata, and MNX states one on the event. ' +
        "The first fermata of the chord's own note is the one converted.",
    ])
  })

  test('says no fermata is converted where only the other note carries two', () => {
    const { warnings } = read(chord('', twoStaves))

    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'inconsistent:fermata',
        'A note of a chord carries a <fermata> the note it joins does not. MNX states the ' +
          "fermata once for the chord, and the chord's own is the one converted.",
      ],
      [
        'unrepresentable:fermata',
        'A note of a chord carries more than one fermata, and MNX states one on the event. ' +
          "The chord's own note carries no fermata, so none is converted.",
      ],
    ])
  })

  test('says nothing of a note restating fewer of the chord’s fermatas', () => {
    const { warnings } = read(chord(twoStaves + '<fermata>square</fermata>', twoStaves))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:fermata'])
  })

  test('reports a second fermata on a note of a chord whose first differs', () => {
    const { warnings } = read(
      chord(twoStaves, '<fermata>square</fermata><fermata type="inverted"/>'),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:fermata', 'fermata'],
      ['inconsistent:fermata', 'fermata'],
      ['unrepresentable:fermata', 'fermata'],
    ])
  })
})
