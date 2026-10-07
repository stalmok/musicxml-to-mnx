// A rest can be pinned to a height on the staff with <display-step> and
// <display-octave>, read against the clef in force. MNX states that height as
// rest.staffPosition, staff steps from the middle line, the same count the
// clef itself is placed by.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
import { convertMusicXML } from '../index.js'

const TREBLE = '<clef><sign>G</sign><line>2</line></clef>'

function inMeasure(body: string, clef = TREBLE): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes><divisions>4</divisions>${clef}</attributes>` +
    `${body}</measure></part></score-partwise>`
  )
}

function displayRest(step: string, octave: number): string {
  return (
    `<note><rest><display-step>${step}</display-step>` +
    `<display-octave>${String(octave)}</display-octave></rest>` +
    '<duration>4</duration><type>quarter</type></note>'
  )
}

function firstEvent(source: string) {
  const warnings = new WarningCollector()
  const score = readValid(source, warnings)
  const item = score.parts[0]?.measures[0]?.sequences[0]?.content[0]
  return { item, warnings: warnings.list() }
}

describe('a rest placed on the staff', () => {
  test('places a rest on the treble clef by its display pitch', () => {
    // G4 sits on the second line of a treble staff, two steps below the middle.
    const { item, warnings } = firstEvent(inMeasure(displayRest('G', 4)))

    expect(item).toMatchObject({ isRest: true, staffPosition: -2 })
    expect(warnings).toEqual([])
  })

  test('reads the middle line as position zero', () => {
    // B4 sits on the middle line of a treble staff.
    const { item } = firstEvent(inMeasure(displayRest('B', 4)))

    expect(item).toMatchObject({ staffPosition: 0 })
  })

  test('places a rest on the bass clef', () => {
    // D3 sits on the middle line of a bass staff.
    const { item } = firstEvent(
      inMeasure(displayRest('D', 3), '<clef><sign>F</sign><line>4</line></clef>'),
    )

    expect(item).toMatchObject({ staffPosition: 0 })
  })

  test('places a rest on a C clef by the line the clef sits on', () => {
    // An alto clef puts C4 on the middle line; a tenor clef, on the fourth line.
    const alto = firstEvent(
      inMeasure(displayRest('C', 4), '<clef><sign>C</sign><line>3</line></clef>'),
    )
    const tenor = firstEvent(
      inMeasure(displayRest('C', 4), '<clef><sign>C</sign><line>4</line></clef>'),
    )

    expect(alto.item).toMatchObject({ staffPosition: 0 })
    expect(tenor.item).toMatchObject({ staffPosition: 2 })
  })

  test('follows a clef that changes partway through the measure', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      inMeasure(
        '<note><pitch><step>C</step><octave>4</octave></pitch>' +
          '<duration>4</duration><type>quarter</type></note>' +
          '<attributes><clef><sign>F</sign><line>4</line></clef></attributes>' +
          displayRest('D', 3),
      ),
      warnings,
    )
    // The second event is the display rest, read against the bass clef the
    // mid-measure <attributes> put in force: D3 is the bass staff's middle line.
    const rest = score.parts[0]?.measures[0]?.sequences[0]?.content[1]

    expect(rest).toMatchObject({ isRest: true, staffPosition: 0 })
  })

  test('leaves a plain rest without a position', () => {
    const { item, warnings } = firstEvent(
      inMeasure('<note><rest/><duration>4</duration><type>quarter</type></note>'),
    )

    expect(item).toMatchObject({ isRest: true, staffPosition: undefined })
    expect(warnings).toEqual([])
  })

  // A height needs both halves to place. A rest that states only one is
  // reported, because the source meant to place it and the place cannot be
  // worked out.
  test.each([
    ['a step and no octave', '<display-step>G</display-step>', 'display-step'],
    ['an octave and no step', '<display-octave>4</display-octave>', 'display-octave'],
  ])('reports a rest stating %s', (_what, half, stated) => {
    const { item, warnings } = firstEvent(
      inMeasure(`<note><rest>${half}</rest><duration>4</duration><type>quarter</type></note>`),
    )

    expect(item).toMatchObject({ isRest: true, staffPosition: undefined })
    expect(warnings.map((w) => w.element)).toEqual([stated])
  })

  test('writes a rest position the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(displayRest('G', 4)))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event).toMatchObject({ rest: { staffPosition: -2 } })
  })

  // A rest that fills its measure becomes MNX's full-measure rest, which
  // carries a staffPosition of its own, so its display height is placed there.
  test('places a display height on a rest that fills its measure', () => {
    const source = inMeasure(
      '<note><rest measure="yes"><display-step>G</display-step>' +
        '<display-octave>4</display-octave></rest><duration>4</duration></note>',
    )
    const warnings = new WarningCollector()
    const score = readValid(source, warnings)

    expect(score.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toMatchObject({
      staffPosition: -2,
    })
    expect(warnings.list()).toEqual([])
  })

  test('writes a full-measure rest height the spec schema accepts', () => {
    const { mnx } = convertValid(
      inMeasure(
        '<note><rest measure="yes"><display-step>G</display-step>' +
          '<display-octave>4</display-octave></rest><duration>4</duration></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({ staffPosition: -2 })
  })
})

// MNX states a rest that fills a measure on the sequence, not as an event in
// it, so the voice's sequence is where that rest is written. A sequence with
// empty content is therefore the rest itself.
describe('a voice holding only a rest that fills its measure', () => {
  test('writes the rest on a sequence with no content', () => {
    const { mnx, warnings } = convertValid(
      inMeasure('<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings).toEqual([])
  })

  // With no length to hold against the voice, the mark is taken as written
  // rather than checked once the voice is whole.
  test('writes a marked rest stating no <duration> on the sequence', () => {
    const { mnx } = convertValid(
      inMeasure('<note><rest measure="yes"/><type>whole</type><voice>1</voice></note>'),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: { visualDuration: { base: 'whole' } } },
    ])
  })

  // The resting voice sits beside a sounding one. Without the sequence, the
  // measure would say the voice is not there, not that it rests.
  test('keeps the resting voice beside a sounding one', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          '<note><rest measure="yes"/><duration>4</duration><voice>2</voice></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) => [
        sequence.voice,
        sequence.content.length,
        sequence.fullMeasure !== undefined,
      ]),
    ).toEqual([
      ['1', 1, false],
      ['2', 0, true],
    ])
    expect(warnings).toEqual([])
  })

  // MNX's rest on the sequence carries no marking, and a rest event does. A
  // rest a note value can write stays an event to keep the mark, as it does
  // for a lyric.
  test('keeps a marked rest an event where a note value can write it', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          '<notations><articulations><accent/></articulations></notations></note>',
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toEqual([
      expect.objectContaining({ duration: { base: 'quarter' }, markings: { accent: {} } }),
    ])
    expect(warnings).toEqual([])
  })

  test('keeps both marks of a rest with a fermata and a staccato', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          '<notations><fermata/><articulations><staccato/></articulations></notations></note>',
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toEqual([
      expect.objectContaining({ markings: { staccato: {} }, fermata: {} }),
    ])
    expect(warnings).toEqual([])
  })

  test('keeps a marked rest an event beside another voice', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          '<note><rest measure="yes"/><duration>4</duration><voice>2</voice>' +
          '<notations><articulations><accent/></articulations></notations></note>',
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[1]

    expect(sequence?.voice).toBe('2')
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toEqual([expect.objectContaining({ markings: { accent: {} } })])
    expect(warnings).toEqual([])
  })

  // A mark with no MNX marking leaves nothing for the event to keep, so the
  // rest stays on the sequence and the mark is reported.
  test.each([
    ['fingering', '<technical><fingering>1</fingering></technical>'],
    ['tremolo', '<ornaments><tremolo type="unmeasured">3</tremolo></ornaments>'],
  ])('reports a %s on a rest left on the sequence', (element, notations) => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          `<notations>${notations}</notations></note>`,
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings.map((warning) => warning.element)).toEqual([element])
  })

  // MNX's rest on the sequence carries no stem either, so a stem keeps the
  // rest an event whether or not the source states the value it is drawn as.
  test.each([
    ['states no value', ''],
    ['states its value', '<type>quarter</type>'],
  ])('keeps a stemmed rest an event where the source %s', (_, type) => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        `<note><rest measure="yes"/><duration>4</duration><voice>1</voice>${type}` +
          '<stem>down</stem></note>',
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toEqual([
      { duration: { base: 'quarter' }, rest: {}, stemDirection: 'down' },
    ])
    expect(warnings).toEqual([])
  })

  test('leaves a rest under a beam on the sequence', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          '<beam number="1">begin</beam></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings).toEqual([])
  })

  // A rest is drawn with no stem, so a stem of none on one states nothing.
  test('reads a stem of none on a rest a marking keeps an event as losing nothing', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice><stem>none</stem>' +
          '<notations><articulations><accent/></articulations></notations></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content).toEqual([
      { duration: { base: 'quarter' }, rest: {}, markings: { accent: {} } },
    ])
    expect(warnings).toEqual([])
  })

  test.each([
    ['none', []],
    ['double', ['unrepresentable:stem-direction']],
  ])('leaves a rest with a stem of %s on the sequence', (stem, lost) => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          `<stem>${stem}</stem></note>`,
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings.map((warning) => warning.code)).toEqual(lost)
  })

  test('reports the stem of a rest no note value can write', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions><time><beats>5</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        '<note><rest measure="yes"/><duration>20</duration><voice>1</voice>' +
        '<stem>up</stem></note>' +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings.map((warning) => [warning.code, warning.element])).toEqual([
      ['unrepresentable:element', 'stem'],
    ])
  })

  test('reports the marking of a rest no note value can write', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions><time><beats>5</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        '<note><rest measure="yes"/><duration>20</duration><voice>1</voice>' +
        '<notations><articulations><accent/></articulations></notations></note>' +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings.map((warning) => [warning.code, warning.element])).toEqual([
      ['unrepresentable:element', 'accent'],
    ])
  })
})

// A rest filling the measure that stays an event to keep what it carries
// still rests the measure, so the voice treats what follows it as it would
// for the sequence's own rest.
describe('a rest filling the measure kept as an event', () => {
  const grace =
    '<note><grace/><pitch><step>D</step><octave>5</octave></pitch>' +
    '<type>quarter</type><voice>1</voice></note>'
  const keptRests = [
    [
      'a marking',
      '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
        '<notations><articulations><accent/></articulations></notations></note>',
    ],
    [
      'a stem',
      '<note><rest measure="yes"/><duration>4</duration><voice>1</voice><stem>up</stem></note>',
    ],
    [
      'a lyric',
      '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
        '<lyric><text>la</text></lyric></note>',
    ],
    [
      'grace notes after it',
      '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>' + grace,
    ],
  ]
  const shortRest = '<note><rest/><duration>2</duration><voice>1</voice><type>eighth</type></note>'

  test.each(keptRests)('drops an extra rest after a rest with %s, reporting it', (_, rest) => {
    const { mnx, warnings } = convertValid(inMeasure(rest + shortRest))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.flatMap((item) => ('type' in item ? [] : [item.duration]))).toEqual([
      { base: 'quarter' },
    ])
    expect(warnings.map((warning) => warning.code)).toEqual(['redundant:rest'])
  })

  const refusal = (source: string) => {
    try {
      convertMusicXML(source)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }

  test.each(keptRests)('refuses a note after a rest with %s', (_, rest) => {
    expect(
      refusal(
        inMeasure(
          rest +
            '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration>' +
            '<voice>1</voice><type>eighth</type></note>',
        ),
      ),
    ).toContain('both a rest that fills the measure and notes in it')
  })

  test.each(keptRests.slice(0, 3))('refuses a rest with %s after a note', (_, rest) => {
    expect(
      refusal(
        inMeasure(
          '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration>' +
            '<voice>1</voice><type>eighth</type></note>' +
            rest,
        ),
      ),
    ).toContain('both a rest that fills the measure and notes in it')
  })

  // Notes laid over the rest after a <backup> are a second line of the voice,
  // as they are over the sequence's own rest.
  test.each(keptRests)('lays notes over a rest with %s into a line of their own', (_, rest) => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        rest +
          '<backup><duration>4</duration></backup>' +
          '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration>' +
          '<voice>1</voice><type>quarter</type></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) =>
        sequence.content.flatMap((item) => ('type' in item ? [] : [item.rest !== undefined])),
      ),
    ).toEqual([[true], [false]])
    expect(warnings.map((warning) => warning.code)).toEqual(['inconsistent:voice'])
  })

  // A rest that states its value is checked once the voice is whole, so notes
  // after it make it an ordinary rest rather than the measure's.
  test('converts notes after a stemmed rest that states its value', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          '<type>quarter</type><stem>up</stem></note>' +
          '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration>' +
          '<voice>1</voice><type>eighth</type></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences[0]?.content.flatMap((item) =>
        'type' in item ? [] : [item.duration],
      ),
    ).toEqual([{ base: 'quarter' }, { base: 'eighth' }])
    expect(warnings).toEqual([])
  })

  // A second rest filling the measure is refused whatever it carries, as it
  // is where neither carries anything.
  test.each([
    ['a plain rest', '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'],
    ...keptRests,
  ])('refuses a marked rest filling the measure after %s', (_, rest) => {
    expect(
      refusal(
        inMeasure(
          rest +
            '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
            '<notations><articulations><staccato/></articulations></notations></note>',
        ),
      ),
    ).toContain('more than one rest that fills the measure')
  })
})

// A voice can rest its measure in one sequence and sing in another laid over
// it. A rest among that sequence's notes is part of its music, not silence
// over the measure rest.
describe('a rest in a line laid over a measure rest', () => {
  const measureRest = (body = '') =>
    `<note><rest measure="yes"/><duration>16</duration><voice>1</voice>${body}</note>` +
    '<backup><duration>16</duration></backup>'
  const halfRest = '<note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>'
  const halfNote =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<voice>1</voice><type>half</type></note>'
  const secondLine = (source: string) => {
    const { mnx, warnings } = convertValid(inMeasure(source))
    const content = mnx.parts[0]?.measures[0]?.sequences[1]?.content ?? []
    return {
      kinds: content.map((item) => ('type' in item ? item.type : 'rest' in item ? 'rest' : 'note')),
      codes: warnings.map((warning) => warning.code),
    }
  }

  test.each([
    ['on the sequence, before the note', measureRest() + halfRest + halfNote, ['rest', 'note']],
    ['on the sequence, after the note', measureRest() + halfNote + halfRest, ['note', 'rest']],
    [
      'kept as an event for its lyric',
      measureRest('<lyric><text>la</text></lyric>') + halfRest + halfNote,
      ['rest', 'note'],
    ],
    [
      'in a voice named with spaces around it',
      (measureRest() + halfRest + halfNote).replaceAll('<voice>1</voice>', '<voice> 1 </voice>'),
      ['rest', 'note'],
    ],
    [
      'in a voice with no name',
      (measureRest() + halfRest + halfNote).replaceAll('<voice>1</voice>', ''),
      ['rest', 'note'],
    ],
  ])('keeps the rest beside a measure rest %s', (_, source, kinds) => {
    expect(secondLine(source)).toEqual({ kinds, codes: ['inconsistent:voice'] })
  })

  test('keeps a measure rest written back over the notes of its voice as a line', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
          '<voice>1</voice><type>whole</type></note>' +
          '<backup><duration>16</duration></backup>' +
          '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>',
      ),
    )
    const sequences = mnx.parts[0]?.measures[0]?.sequences

    expect(sequences?.map((sequence) => sequence.fullMeasure)).toEqual([undefined, {}])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
  })

  // Written straight after the measure rest, with no <backup>, the rest falls
  // in the line that rests the measure, whatever the other line sings.
  test('drops a rest after the measure rest in its own line', () => {
    const source =
      '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
      halfRest +
      '<backup><duration>24</duration></backup>' +
      halfNote

    expect(secondLine(source)).toEqual({
      kinds: ['note'],
      codes: ['redundant:rest', 'inconsistent:voice'],
    })
  })

  // Another voice sounding a note says nothing about this one.
  test('drops a rest over the measure rest where only another voice sounds', () => {
    const otherVoice = halfNote.replace('<voice>1</voice>', '<voice>2</voice>')
    const { mnx, warnings } = convertValid(inMeasure(measureRest() + halfRest + otherVoice))

    expect(mnx.parts[0]?.measures[0]?.sequences.map((sequence) => sequence.voice)).toEqual([
      '1',
      '2',
    ])
    expect(warnings.map((warning) => warning.code)).toEqual(['redundant:rest'])
  })

  // A grace note sounds too, and ornaments the rest after it.
  test('keeps the rests around a grace note laid over the measure rest', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>5</octave></pitch>' +
      '<voice>1</voice><type>eighth</type></note>'

    expect(secondLine(measureRest() + halfRest + grace + halfRest)).toEqual({
      kinds: ['rest', 'grace', 'rest'],
      codes: ['inconsistent:voice'],
    })
  })
})

describe('a rest dropped over a measure rest', () => {
  const measureRest =
    '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>' +
    '<backup><duration>16</duration></backup>'
  const wholeRest = (body: string, hidden = false) =>
    `<note${hidden ? ' print-object="no"' : ''}><rest/><duration>16</duration>` +
    `<voice>1</voice><type>whole</type>${body}</note>`
  const lost = (source: string) => {
    const { mnx, warnings } = convertValid(inMeasure(source))
    return {
      sequences: mnx.parts[0]?.measures[0]?.sequences,
      lost: warnings.map((w) => [w.code, w.element]),
    }
  }

  test('reports each thing the rest carries', () => {
    const { sequences, lost: reported } = lost(
      measureRest +
        wholeRest(
          '<stem>up</stem><notations><fermata/><articulations><accent/></articulations>' +
            '</notations><lyric><text>la</text></lyric>',
        ),
    )

    expect(sequences).toEqual([{ voice: '1', fullMeasure: {}, content: [] }])
    expect(reported).toEqual([
      ['redundant:rest', 'rest'],
      ['redundant:rest', 'stem'],
      ['redundant:rest', 'fermata'],
      ['redundant:rest', 'accent'],
      ['redundant:rest', 'lyric'],
    ])
  })

  test('reads and does not report what the source does not draw', () => {
    const { lost: reported } = lost(
      measureRest +
        wholeRest(
          '<stem>up</stem><notations print-object="no"><articulations><accent/></articulations>' +
            '</notations>',
          true,
        ),
    )

    expect(reported).toEqual([['redundant:rest', 'rest']])
  })

  test('reports a slur started on the rest once, where it starts', () => {
    const note =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
      '<voice>2</voice><type>whole</type><notations><slur type="stop"/></notations></note>'
    const { lost: reported } = lost(
      measureRest +
        wholeRest('<notations><slur type="start"/></notations>') +
        '<backup><duration>16</duration></backup>' +
        note,
    )

    expect(reported).toEqual([
      ['redundant:rest', 'rest'],
      ['redundant:rest', 'slur'],
    ])
  })

  test('reports a slur stopped on the rest once, where it stops', () => {
    const note =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
      '<voice>2</voice><type>whole</type><notations><slur type="start"/></notations></note>'
    const { lost: reported } = lost(
      note +
        '<backup><duration>16</duration></backup>' +
        measureRest +
        wholeRest('<notations><slur type="stop"/></notations>'),
    )

    expect(reported).toEqual([
      ['redundant:rest', 'rest'],
      ['redundant:rest', 'slur'],
    ])
  })

  // A grace note takes none of the measure's time, so a grace rest is not
  // silence over the measure rest. The measure rest stays an event for the
  // grace notes to stand beside.
  test('keeps a grace rest written over the measure rest', () => {
    const { sequences, lost: reported } = lost(
      measureRest + '<note><grace/><rest/><voice>1</voice><type>eighth</type></note>',
    )

    expect(sequences?.[0]?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'event',
      'grace',
    ])
    expect(reported).toEqual([])
  })

  test('says nothing of a beam on the rest, which beams nothing', () => {
    expect(lost(measureRest + wholeRest('<beam number="1">begin</beam>')).lost).toEqual([
      ['redundant:rest', 'rest'],
    ])
  })

  // Read before the rest's own ratio opens, its length has no note value, as a
  // rest filling an irregular measure has none. It is still a rest over the
  // measure rest.
  test.each([
    ['3', '2', '2'],
    ['5', '4', '5'],
  ])(
    'drops a rest with no value in a %s:%s ratio lasting %s divisions',
    (actual, normal, units) => {
      const { mnx, warnings } = convertValid(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
          '</time></attributes>' +
          '<note><rest measure="yes"/><duration>12</duration><voice>1</voice></note>' +
          '<backup><duration>12</duration></backup>' +
          `<note><rest/><duration>${units}</duration><voice>1</voice><time-modification>` +
          `<actual-notes>${actual}</actual-notes><normal-notes>${normal}</normal-notes>` +
          '<normal-type>quarter</normal-type></time-modification></note>' +
          '</measure></part></score-partwise>',
      )

      expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
        { voice: '1', fullMeasure: {}, content: [] },
      ])
      expect(warnings.map((w) => [w.code, w.element])).toEqual([['redundant:rest', 'rest']])
    },
  )

  test('refuses a rest stating neither a value nor a duration', () => {
    expect(() =>
      convertMusicXML(inMeasure(measureRest + '<note><rest/><voice>1</voice></note>')),
    ).toThrow('A <note> states neither a <type> nor a <duration>.')
  })

  // The voice rests the measure, so the rest's own ratio is all that scales
  // it, and the cursor moves on by the length the ratio gives it.
  test('moves the cursor past a rest with no duration by its ratio', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        '<note><rest measure="yes"/><duration>48</duration><voice>1</voice></note>' +
        '<backup><duration>48</duration></backup>' +
        '<note><rest/><voice>1</voice><type>eighth</type><time-modification>' +
        '<actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>' +
        '<backup><duration>4</duration></backup>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration>' +
        '<voice>2</voice><type>whole</type></note>' +
        '</measure></part></score-partwise>',
    )

    const voice2 = mnx.parts[0]?.measures[0]?.sequences[1]?.content
    expect(voice2?.map((item) => ('type' in item ? item.type : 'event'))).toEqual(['event'])
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['redundant:rest', 'rest']])
  })
})

// A <backup> reaching back further than the measure has run is reported where
// the music after it is written, which for a rest filling the measure is the
// rest itself.
describe('a measure rest written after a backup past the measure start', () => {
  test('reports the reach and writes the rest at the measure start', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<backup><duration>8</duration></backup>' +
          '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>',
      ),
    )

    expect(warnings.map((warning) => warning.code)).toEqual(['inconsistent:backup'])
    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
  })
})

// A grace note takes none of the measure's time, so a voice leading into a
// measure of silence with one still rests through it. MNX wants the sequence
// stating a full-measure rest to hold nothing, so the rest is written as the
// event its length has a value for and the grace notes stand beside it. Which
// side of the rest the grace notes are written on says nothing about the
// music, so both orders convert to the same thing.
describe('a rest filling a measure a grace note leads into', () => {
  const grace =
    '<note><grace/><pitch><step>D</step><octave>5</octave></pitch>' +
    '<type>quarter</type><voice>1</voice></note>'
  const measureRest = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'

  test('writes the rest as an event beside the grace notes', () => {
    const { mnx, warnings } = convertValid(inMeasure(grace + measureRest))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'grace',
      'event',
    ])
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('states the rest with the value its length is written as', () => {
    const { mnx } = convertValid(inMeasure(grace + measureRest))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[1]

    expect(event && !('type' in event) && event.duration).toEqual({ base: 'quarter' })
    expect(event && !('type' in event) && event.rest).toEqual({})
  })

  // Nothing is different where the voice holds no grace note: the rest is
  // still the sequence's own.
  test('leaves a rest with no grace note before it on the sequence', () => {
    const { mnx } = convertValid(inMeasure(measureRest))

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
  })

  // A grace note over a resting bar is as often written after the rest as
  // before it, and leads into the next measure's downbeat either way, so the
  // rest is written as the same event in both orders.
  test('writes the rest as an event where the grace notes follow it', () => {
    const { mnx, warnings } = convertValid(inMeasure(measureRest + grace))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'event',
      'grace',
    ])
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('states the rest that follows the grace notes with its own value', () => {
    const { mnx } = convertValid(inMeasure(measureRest + grace))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && !('type' in event) && event.duration).toEqual({ base: 'quarter' })
    expect(event && !('type' in event) && event.rest).toEqual({})
  })

  // A <backup> written over the rest takes the voice to the measure start,
  // and what follows there is a second line of the voice rather than music
  // written after the rest. A grace note there leads into that line's note.
  test('leaves the rest alone where the grace note leads into another line', () => {
    const { mnx } = convertValid(
      inMeasure(
        measureRest +
          '<backup><duration>4</duration></backup>' +
          grace +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) => [
        sequence.content.map((item) => ('type' in item ? item.type : 'event')),
        sequence.fullMeasure !== undefined,
      ]),
    ).toEqual([
      [[], true],
      [['grace', 'event'], false],
    ])
  })

  // A voice that rests one line of the measure can sound another. The rest
  // is the first line's, so a grace note in the line the voice is sounding
  // stands there and leaves the rest where it is.
  test('leaves a measure rest in another line of the voice alone', () => {
    const { mnx } = convertValid(
      inMeasure(
        measureRest +
          '<backup><duration>4</duration></backup>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>' +
          grace,
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) => [
        sequence.content.map((item) => ('type' in item ? item.type : 'event')),
        sequence.fullMeasure !== undefined,
      ]),
    ).toEqual([
      [[], true],
      [['event', 'grace'], false],
    ])
  })

  // A bracket the grace note itself opens starts at the grace note, so the rest
  // written before it stands outside it. The same two written the other way
  // round are refused, because there the bracket reaches the rest.
  test('leaves the rest outside a bracket the grace note opens', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        measureRest +
          '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type>' +
          '<voice>1</voice><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes></time-modification>' +
          '<notations><tuplet type="start" number="1"/></notations></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences[0]?.content.map((item) =>
        'type' in item ? item.type : 'event',
      ),
    ).toEqual(['event', 'grace'])
    expect(warnings.map((warning) => warning.code)).toEqual([
      'unrepresentable:tuplet-span',
      'unrepresentable:tuplet-untimed',
    ])
  })

  // The rest counts once toward the staff the voice sits on, whichever side
  // of it the grace notes stand, so two grace notes on the other staff
  // outweigh it in both orders.
  test.each([
    ['before', 1],
    ['after', 0],
  ])('places the voice by the grace notes %s the rest', (order, at) => {
    const staves =
      '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>' +
      '<clef number="2"><sign>F</sign><line>4</line></clef>'
    const onStaff2 = grace.replace('</voice>', '</voice><staff>2</staff>')
    const rest = measureRest.replace('</voice>', '</voice><staff>1</staff>')
    const graces = onStaff2 + onStaff2
    const { mnx } = convertValid(
      inMeasure(order === 'before' ? graces + rest : rest + graces, staves),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]
    const event = sequence?.content[at]

    expect(sequence?.staff).toBe(2)
    expect(event && !('type' in event) && event.staff).toBe(1)
  })

  // The grace note leads into a rest the voice drops as silence over its
  // measure rest, so it stays in the line that rests the measure, and the
  // rest there is written as an event.
  test('writes the rest as an event where a grace note is carried back beside it', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        measureRest +
          '<backup><duration>4</duration></backup>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
          '<type>half</type><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          grace +
          '<note><rest/><duration>2</duration><voice>1</voice><type>eighth</type></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) => [
        sequence.content.map((item) => ('type' in item ? item.type : 'event')),
        sequence.fullMeasure,
      ]),
    ).toEqual([
      [['event', 'grace'], undefined],
      [['event'], undefined],
    ])
    expect(warnings.map((warning) => warning.code)).toEqual([
      'redundant:rest',
      'inconsistent:voice',
    ])
  })

  // The rest takes its form before the bracket after it settles. Standing as
  // a space of its length until then, it would be silence the bracket takes
  // in as its own.
  test('keeps the rest out of the silence before a bracket the grace note opens', () => {
    const tupletGrace = (type: string) =>
      '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type>' +
      '<voice>1</voice><time-modification><actual-notes>3</actual-notes>' +
      `<normal-notes>2</normal-notes></time-modification><notations><tuplet type="${type}"/>` +
      '</notations></note>'
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>12</divisions>' +
        '<time><beats>2</beats><beat-type>4</beat-type></time>' +
        `${TREBLE}</attributes>` +
        '<note><rest measure="yes"/><duration>6</duration><voice>1</voice></note>' +
        tupletGrace('start') +
        '<forward><duration>4</duration></forward>' +
        tupletGrace('stop') +
        '</measure></part></score-partwise>',
    )

    const content = mnx.parts[0]?.measures[0]?.sequences[0]?.content
    expect(content?.[0]).toEqual({ duration: { base: 'eighth' }, rest: {} })
    const tuplet = content?.[1]
    expect(tuplet && 'type' in tuplet && tuplet.type === 'tuplet' && tuplet.content).toEqual([
      expect.objectContaining({ type: 'grace' }),
      { type: 'space', duration: [1, 8] },
      expect.objectContaining({ type: 'grace' }),
      { type: 'space', duration: [1, 4] },
    ])
    expect(content).toHaveLength(2)
  })

  // A <forward> before the rest is silence the voice passed over, and MNX
  // states it as a space. The rest is written where it stands, so the space
  // before it stands too.
  test('keeps the silence the source passed over before the rest', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<forward><duration>2</duration></forward>' +
          '<note><rest measure="yes"/><duration>2</duration><voice>1</voice></note>' +
          grace,
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content).toEqual([
      { type: 'space', duration: [1, 8] },
      { duration: { base: 'eighth' }, rest: {} },
      expect.objectContaining({ type: 'grace' }),
    ])
    expect(warnings).toEqual([])
  })

  // Which side of the rest the grace notes are written on says nothing about
  // the rest, so what the rest carries converts the same either way.
  const stemmedRest =
    '<note><rest measure="yes"/><duration>4</duration><voice>1</voice><stem>up</stem></note>'
  const markedRest =
    '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
    '<notations><articulations><staccato/></articulations></notations></note>'

  test.each([
    ['stem', 'before', grace + stemmedRest, 1, [{}, 'up']],
    ['stem', 'after', stemmedRest + grace, 0, [{}, 'up']],
    ['marking', 'before', grace + markedRest, 1, [{ staccato: {} }, undefined]],
    ['marking', 'after', markedRest + grace, 0, [{ staccato: {} }, undefined]],
  ])('keeps the %s of the rest with the grace notes %s it', (_, __, body, at, expected) => {
    const { mnx, warnings } = convertValid(inMeasure(body))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[at]

    expect(event && !('type' in event) && [event.markings ?? {}, event.stemDirection]).toEqual(
      expected,
    )
    expect(warnings).toEqual([])
  })

  test('reads a stem of none on the rest the grace notes follow as losing nothing', () => {
    const { warnings } = convertValid(
      inMeasure(stemmedRest.replace('<stem>up</stem>', '<stem>none</stem>') + grace),
    )

    expect(warnings).toEqual([])
  })

  // The grace notes stand where the voice last was, and a <forward> moves the
  // cursor past them. A rest reached there does not open the measure, so it
  // is not the measure's rest and the voice cannot hold both.
  test('refuses where a forward moved the cursor past the grace notes', () => {
    let thrown = ''
    try {
      convertMusicXML(
        inMeasure(
          grace +
            '<forward><duration>2</duration></forward>' +
            '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
  })

  // An irregular measure has no note value to write the rest as, so there is
  // nothing to make an event of. The rest is written as a space of its
  // length beside the grace notes, on whichever side they are written.
  const irregular = (
    body: string,
    time = '<time><beats>5</beats><beat-type>4</beat-type></time>',
  ) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes><divisions>4</divisions>${time}</attributes>` +
    body +
    '</measure></part></score-partwise>'
  const irregularRest = '<note><rest measure="yes"/><duration>20</duration><voice>1</voice></note>'
  const kinds = (body: string, time?: string) => {
    const { mnx, warnings } = convertValid(irregular(body, time))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]
    return {
      fullMeasure: sequence?.fullMeasure,
      content: sequence?.content.map((item) =>
        'type' in item && item.type === 'space'
          ? ['space', item.duration]
          : ['type' in item ? item.type : 'event'],
      ),
      warnings: warnings.map((w) => [w.code, w.element, w.context.measure]),
    }
  }
  const space = ['space', [5, 4]]
  const reported = [['unrepresentable:grace-beside-rest', 'rest', 1]]

  test.each([
    ['marked', irregularRest, undefined],
    ['marked with no duration', '<note><rest measure="yes"/><voice>1</voice></note>', undefined],
    [
      'drawn to the measure',
      '<note><rest/><duration>20</duration><voice>1</voice></note>',
      undefined,
    ],
    [
      'in a measure with no time signature',
      '<note><rest/><duration>20</duration><voice>1</voice></note>',
      '',
    ],
  ])('writes a rest %s as a space beside the grace notes, in both orders', (_, rest, time) => {
    expect(kinds(grace + rest, time)).toEqual({
      fullMeasure: undefined,
      content: [['grace'], space],
      warnings: reported,
    })
    expect(kinds(rest + grace, time)).toEqual({
      fullMeasure: undefined,
      content: [space, ['grace']],
      warnings: reported,
    })
  })

  test('reports the space where the rest stands, before what is written after it', () => {
    const direction =
      '<direction><direction-type><other-direction>ad lib.</other-direction>' +
      '</direction-type></direction>'

    expect(kinds(irregularRest + direction + grace).warnings).toEqual([
      ...reported,
      ['unsupported:element', 'other-direction', 1],
    ])
  })

  // The space states the length the rest on the sequence could not, so only
  // the rest that stays on the sequence reports it lost.
  test('reports the length of a rest with no time signature only where it stays on the sequence', () => {
    const bare = '<note><rest/><duration>20</duration><voice>1</voice></note>'

    expect(kinds(bare, '').warnings).toEqual([['unrepresentable:rest-length', 'rest', 1]])
    expect(kinds(bare + grace, '').warnings).toEqual(reported)
    expect(convertValid(irregular(bare, '')).warnings[0]?.message).toContain(
      'a measure written with no time signature',
    )
  })

  // A time signature stated after the rest is the next measure's, so the rest
  // is still in a measure with the time signature it opened with.
  test.each([
    ['with no time signature', '', '<time><beats>3</beats><beat-type>4</beat-type></time>'],
    [
      'with a time signature',
      '<time><beats>5</beats><beat-type>4</beat-type></time>',
      '<time><senza-misura/></time>',
    ],
  ])('words the rest length in a measure that opens %s', (_, opens, late) => {
    const bare = '<note><rest/><duration>18</duration><voice>1</voice></note>'
    const message = (time: string) =>
      convertValid(irregular(bare + `<attributes>${late}</attributes>`, time)).warnings.find(
        (warning) => warning.code === 'unrepresentable:rest-length',
      )?.message

    expect(message(opens)).toContain(
      opens === '' ? 'a measure written with no time signature' : 'no note value can write',
    )
  })

  // The space names no staff, so the rest still counts toward the staff the
  // voice sits on. With one grace note on each staff the two tie, and a tie
  // goes to the staff written first.
  test.each([
    ['before', 0, 1, undefined],
    ['after', 1, 2, 1],
  ])('places the voice by the rest and grace notes %s it', (order, at, staff, graceStaff) => {
    const rest =
      '<note><rest measure="yes"/><duration>20</duration><voice>1</voice><staff>2</staff></note>'
    const onStaff1 = grace.replace('</voice>', '</voice><staff>1</staff>')
    const { mnx, warnings } = convertValid(
      irregular(
        order === 'before' ? onStaff1 + rest : rest + onStaff1,
        '<staves>2</staves><time><beats>5</beats><beat-type>4</beat-type></time>',
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]
    const group = sequence?.content[at]

    expect(sequence?.staff).toBe(staff)
    expect(group && 'type' in group && group.type === 'grace' && group.content[0]?.staff).toBe(
      graceStaff,
    )
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual(reported)
  })

  // The warning is about the rest, so it names the rest's line whichever
  // side the grace notes are written on.
  test.each([
    ['before', grace + '\n' + irregularRest, 2],
    ['after', irregularRest + '\n' + grace, 1],
  ])('reports the line of the rest, with grace notes %s it', (_, body, line) => {
    expect(convertValid(irregular(body)).warnings.map((w) => w.context.line)).toEqual([line])
  })

  // A rest that does not open the measure stands after the silence before it,
  // and the space written for it does too.
  test('keeps the silence before a rest that does not open the measure', () => {
    const late = '<note><rest measure="yes"/><duration>18</duration><voice>1</voice></note>'

    expect(kinds('<forward><duration>2</duration></forward>' + late + grace).content).toEqual([
      ['space', [1, 8]],
      ['space', [9, 8]],
      ['grace'],
    ])
  })

  // The space is as long as the source makes the rest, as a rest standing as
  // an event would be, even where that leaves the voice short of the measure.
  test('writes a rest shorter than the measure as a space of its own length', () => {
    expect(kinds(grace + '<note><rest/><duration>5</duration><voice>1</voice></note>')).toEqual({
      fullMeasure: undefined,
      content: [['grace'], ['space', [5, 16]]],
      warnings: reported,
    })
  })

  // A grace note after a <backup> over the rest leads into another line, so
  // the rest stays on the sequence. Marked as the measure's, it loses no
  // length there.
  test('leaves a rest no note value writes on the sequence beside another line', () => {
    const { mnx, warnings } = convertValid(
      irregular(
        irregularRest +
          '<backup><duration>20</duration></backup>' +
          grace +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>',
      ),
    )

    expect(
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) => [
        sequence.content.map((item) => ('type' in item ? item.type : 'event')),
        sequence.fullMeasure,
      ]),
    ).toEqual([
      [[], {}],
      [['grace', 'event'], undefined],
    ])
    expect(warnings.map((warning) => warning.code)).toEqual(['inconsistent:voice'])
  })

  // A <forward> takes the rest past the grace notes, so it no longer opens
  // the measure, and a rest filling the measure from there would overfill it.
  test('refuses where a forward moved the cursor between the grace notes and the rest', () => {
    let thrown = ''
    try {
      convertMusicXML(
        irregular(grace + '<forward><duration>4</duration></forward>' + irregularRest),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
  })

  const refusal = (body: string, time?: string) => {
    try {
      convertMusicXML(irregular(body, time))
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }

  // Nothing says how long the rest lasts: no <duration>, no time signature
  // and no written value.
  const noLength = '<note><rest measure="yes"/><voice>1</voice></note>'
  test.each([
    ['before', grace + noLength],
    ['after', noLength + grace],
  ])('refuses a rest with grace notes %s it and no length to write a space of', (_, body) => {
    expect(refusal(body, '')).toContain(
      'neither a note value nor a length says how long that rest lasts',
    )
  })

  // The refusal is about the rest, so it names the rest's line whichever
  // side the grace notes are written on.
  test.each([
    ['before', grace + '\n' + noLength, 2],
    ['after', noLength + '\n' + grace, 1],
  ])('names the line of the rest with no length, with grace notes %s it', (_, body, line) => {
    let thrown: unknown
    try {
      convertMusicXML(irregular(body, ''))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ line })
  })

  const graceMember =
    '<note><grace/><chord/><pitch><step>F</step><octave>5</octave></pitch>' +
    '<type>quarter</type><voice>1</voice></note>'

  test('joins a grace chord member to the grace note after the rest', () => {
    const { mnx, warnings } = convertValid(irregular(irregularRest + grace + graceMember))
    const group = mnx.parts[0]?.measures[0]?.sequences[0]?.content[1]

    expect(
      group && 'type' in group && group.type === 'grace' && group.content[0]?.notes,
    ).toHaveLength(2)
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual(reported)
  })

  // The rest stands between the chord member and the grace note before it,
  // and a rest is not a note to join.
  test.each([
    ['a grace note', graceMember],
    [
      'a full note',
      '<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>20</duration>' +
        '<voice>1</voice></note>',
    ],
  ])('refuses %s marked as a chord straight after the rest', (_, member) => {
    expect(refusal(grace + irregularRest + member)).toContain('rest cannot be part of a chord')
  })

  // A note written over the rest in the same voice opens a line of its own,
  // and a grace chord there joins its own grace note.
  test('joins a grace chord member to a grace note in another line of the voice', () => {
    const quarter = (step: string) =>
      `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration>` +
      '<type>quarter</type><voice>1</voice></note>'
    const { mnx, warnings } = convertValid(
      irregular(
        irregularRest +
          grace +
          '<backup><duration>20</duration></backup>' +
          quarter('C') +
          grace.replace('D', 'G') +
          graceMember +
          quarter('D'),
      ),
    )
    const content = mnx.parts[0]?.measures[0]?.sequences[1]?.content
    const group = content?.find((item) => 'type' in item && item.type === 'grace')

    expect(
      group && 'type' in group && group.type === 'grace' && group.content[0]?.notes,
    ).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:grace-beside-rest',
      'inconsistent:voice',
    ])
  })

  test('keeps a slur starting on the grace note after the rest', () => {
    const { mnx, warnings } = convertValid(
      irregular(
        irregularRest +
          '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>quarter</type>' +
          '<voice>1</voice><notations><slur type="start" number="1"/></notations></note>',
      ).replace(
        '</measure></part>',
        '</measure><measure number="2"><note><pitch><step>C</step><octave>5</octave></pitch>' +
          '<duration>4</duration><type>quarter</type><voice>1</voice>' +
          '<notations><slur type="stop" number="1"/></notations></note>' +
          '<forward><duration>16</duration></forward></measure></part>',
      ),
    )
    const group = mnx.parts[0]?.measures[0]?.sequences[0]?.content[1]

    expect(
      group && 'type' in group && group.type === 'grace' && group.content[0]?.slurs,
    ).toHaveLength(1)
    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual(reported)
  })

  // The rest is gone, so what was drawn on it goes with it, and the warning
  // above reports that.
  const withFermata =
    '<note><rest measure="yes"/><duration>20</duration><voice>1</voice>' +
    '<notations><fermata/></notations></note>'
  test.each([
    ['before', grace + withFermata],
    ['after', withFermata + grace],
  ])('reports a fermata on the rest once, as the rest, with grace notes %s it', (_, body) => {
    const { warnings } = convertValid(irregular(body))

    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual(reported)
    expect(warnings[0]?.message).toContain('nor a fermata or a position stated on it')
  })

  // Neither MNX's rest on the sequence nor a space carries what only an event
  // holds, and no note value writes the rest as an event.
  test.each([
    ['a stem', '<stem>up</stem>', 'stem'],
    [
      'a mark',
      '<notations><articulations><staccato placement="above"/></articulations></notations>',
      'staccato',
    ],
    ['a slur', '<notations><slur type="start" number="1" placement="above"/></notations>', 'slur'],
    ['the end of a slur', '<notations><slur type="stop" number="1"/></notations>', 'slur'],
    ['a lyric', '<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>', 'lyric'],
  ])('reports %s on the rest as having no home', (_, inner, element) => {
    const rest = irregularRest.replace('</note>', `${inner}</note>`)
    const carried = ['unrepresentable:element', element, 1]

    expect(kinds(rest).warnings).toEqual([carried])
    expect(kinds(grace + rest).warnings).toEqual([carried, ...reported])
    expect(kinds(rest + grace).warnings).toEqual([carried, ...reported])
  })

  test('says why what the rest carries has no home', () => {
    const { warnings } = convertValid(
      irregular(irregularRest.replace('</note>', '<stem>up</stem></note>')),
    )

    expect(warnings[0]?.message).toBe(
      'A <stem> on a rest that fills the measure is not converted. No note value writes the ' +
        'rest as an event, and neither the rest MNX states on the sequence nor a space ' +
        'written for it carries one.',
    )
  })

  test('reports a mark MNX cannot state once', () => {
    const rest = irregularRest.replace(
      '</note>',
      '<notations><ornaments><tremolo type="single">0</tremolo></ornaments></notations></note>',
    )

    expect(kinds(rest).warnings).toEqual([['unrepresentable:element', 'tremolo', 1]])
  })

  // A slur passing over the rest needs nothing of it.
  test('reports only what the rest carries beside what it cannot', () => {
    const rest = irregularRest.replace(
      '</note>',
      '<notations><articulations><staccato/><doit/></articulations>' +
        '<slur type="continue" number="1"/></notations></note>',
    )

    expect(kinds(rest).warnings).toEqual([
      ['unrepresentable:element', 'staccato', 1],
      ['unsupported:element', 'slur', 1],
      ['unsupported:element', 'doit', 1],
    ])
  })

  test('leaves what the rest does not carry to be reported as any note’s is', () => {
    const rest = irregularRest.replace('<rest measure="yes"/>', '<rest measure="yes" wibble="1"/>')

    expect(kinds(rest.replace('</note>', '<stem>up</stem></note>')).warnings).toEqual([
      ['unrepresentable:element', 'stem', 1],
      ['unsupported:attribute', 'rest', 1],
    ])
  })

  test('reports what the rest carries in the order the source writes it', () => {
    const rest = irregularRest.replace(
      '</note>',
      '<notations><slur type="start" number="1"/></notations>' +
        '<notations><articulations><staccato/><accent/></articulations>' +
        '<technical><down-bow/></technical></notations>' +
        '<notations><articulations><tenuto/></articulations></notations></note>',
    )

    expect(kinds(rest).warnings.map(([, element]) => element)).toEqual([
      'slur',
      'staccato',
      'accent',
      'down-bow',
      'tenuto',
    ])
  })

  // The slur end is lost with the rest, but it still ends or begins its slur,
  // so no other end in the part pairs with one it closed or opened.
  describe('a slur end on the rest', () => {
    const slurNote = (type: string) =>
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration>' +
      '<type>quarter</type><voice>1</voice>' +
      `<notations><slur type="${type}" number="1"/></notations></note>` +
      '<forward><duration>16</duration></forward>'
    const slurRest = (...types: string[]) =>
      irregularRest.replace(
        '</note>',
        `<notations>${types.map((type) => `<slur type="${type}" number="1"/>`).join('')}` +
          '</notations></note>',
      )
    const measures = (...bodies: string[]) =>
      irregular(bodies[0] ?? '').replace(
        '</measure></part>',
        bodies
          .slice(1)
          .map((body, index) => `</measure><measure number="${String(index + 2)}">${body}`)
          .join('') + '</measure></part>',
      )
    const convert = (...bodies: string[]) => {
      const { mnx, warnings } = convertValid(measures(...bodies))
      return {
        slurs: mnx.parts[0]?.measures.flatMap((measure) =>
          measure.sequences.flatMap((sequence) =>
            sequence.content.flatMap((item) => ('slurs' in item ? (item.slurs ?? []) : [])),
          ),
        ),
        warnings: warnings.map((w) => [w.code, w.element, w.context.measure]),
      }
    }

    test('closes a slur and opens the next, writing neither', () => {
      expect(convert(slurNote('start'), slurRest('stop', 'start'), slurNote('stop'))).toEqual({
        slurs: [],
        warnings: [
          ['unrepresentable:element', 'slur', 2],
          ['unrepresentable:element', 'slur', 2],
        ],
      })
    })

    test('closes a slur and opens the next where the rest writes the start first', () => {
      expect(convert(slurNote('start'), slurRest('start', 'stop'), slurNote('stop'))).toEqual({
        slurs: [],
        warnings: [
          ['unrepresentable:element', 'slur', 2],
          ['unrepresentable:element', 'slur', 2],
        ],
      })
    })

    test('closes the slur a note before it opens', () => {
      expect(convert(slurNote('start'), slurRest('stop'))).toEqual({
        slurs: [],
        warnings: [['unrepresentable:element', 'slur', 2]],
      })
    })

    test('opens the slur a note after it closes', () => {
      expect(convert(slurRest('start'), slurNote('stop'))).toEqual({
        slurs: [],
        warnings: [['unrepresentable:element', 'slur', 1]],
      })
    })

    test('leaves a later stop with no start as an orphan', () => {
      expect(convert(slurNote('start'), slurRest('stop'), slurNote('stop'))).toEqual({
        slurs: [],
        warnings: [
          ['unrepresentable:element', 'slur', 2],
          ['unclosed:spanner', 'slur', 3],
        ],
      })
    })
  })

  // A hidden rest is time with nothing drawn in it, which is what a space is.
  const hidden = (inner = '') =>
    '<note print-object="no"><rest measure="yes"/><duration>20</duration><voice>1</voice>' +
    `${inner}</note>`
  const hiddenReported = [['unsupported:attribute', 'note', 1]]

  test.each([
    ['before', grace + hidden()],
    ['after', hidden() + grace],
  ])('writes a hidden rest as a space with nothing lost, with grace notes %s it', (_, body) => {
    expect(kinds(body).warnings).toEqual([])
  })

  test('reports a fermata over a hidden rest written as a space', () => {
    expect(kinds(hidden('<notations><fermata/></notations>') + grace).warnings).toEqual(reported)
  })

  test.each([
    ['no note value writes', undefined],
    ['a note value writes', '<time><beats>4</beats><beat-type>4</beat-type></time>'],
  ])('reports a hidden rest %s that stays on the sequence as drawn', (_, time) => {
    const rest = time === undefined ? hidden() : hidden().replace('20', '16')

    expect(kinds(rest, time).warnings).toEqual(hiddenReported)
  })

  // A note value writes a whole rest in 4/4, so the rest is written as an
  // event, which is drawn.
  test.each([
    ['before', grace + hidden().replace('20', '16')],
    ['after', hidden().replace('20', '16') + grace],
  ])('reports a hidden rest written as an event, with grace notes %s it', (_, body) => {
    const { content, warnings } = kinds(
      body,
      '<time><beats>4</beats><beat-type>4</beat-type></time>',
    )

    expect(content).toContainEqual(['event'])
    expect(warnings).toEqual(hiddenReported)
  })

  // A rest is drawn with no stem, and a hidden one with nothing at all, so
  // neither loses a stem it states.
  test.each([
    [
      'a stem of none',
      irregularRest.replace('</note>', '<stem default-y="-20"> none </stem></note>'),
      [],
      reported,
    ],
    ['a hidden stem', hidden('<stem default-y="10">up</stem>'), hiddenReported, []],
  ])('reads %s on the rest as losing nothing', (_, rest, onSequence, asSpace) => {
    expect(kinds(rest).warnings).toEqual(onSequence)
    expect(kinds(rest + grace).warnings).toEqual(asSpace)
  })

  // Only the rest is hidden. Its <notations> block is shown, so the marks in
  // it are drawn.
  test('reports a mark in a shown block on a hidden rest', () => {
    const rest = hidden('<notations><articulations><accent/></articulations></notations>')

    expect(kinds(rest + grace).warnings).toEqual([['unrepresentable:element', 'accent', 1]])
  })

  // A mark in a hidden block is not drawn, so losing it loses nothing drawn,
  // and saying the block is drawn anyway would be wrong.
  const hiddenBlock = (inner: string) =>
    irregularRest.replace('</note>', `<notations print-object="no">${inner}</notations></note>`)
  const blockDrawn = ['unrepresentable:attribute', 'notations', 1]

  test('reads a mark in a hidden block on the rest as losing nothing', () => {
    const rest = hiddenBlock('<articulations><accent placement="above"/></articulations>')

    expect(kinds(rest).warnings).toEqual([])
    expect(kinds(rest + grace).warnings).toEqual(reported)
  })

  // A fermata is converted over the rest on the sequence, so the block hiding
  // it is drawn anyway. As a space, the rest carries no fermata at all.
  test('reports a hidden block as drawn only where it holds a fermata the rest keeps', () => {
    const rest = hiddenBlock('<articulations><accent/></articulations><fermata/>')
    const { warnings } = convertValid(irregular(rest))

    expect(warnings.map((w) => [w.code, w.element, w.context.measure])).toEqual([blockDrawn])
    expect(warnings[0]?.message).toContain('The block holds <fermata>.')
    expect(kinds(rest + grace).warnings).toEqual(reported)
  })

  test('reports a hidden rest and a hidden block holding its fermata as drawn', () => {
    const rest = hidden(
      '<notations print-object="no"><articulations><accent/></articulations><fermata/>' +
        '</notations>',
    )

    expect(kinds(rest).warnings).toEqual([...hiddenReported, blockDrawn])
    expect(kinds(rest + grace).warnings).toEqual(reported)
  })

  // The slur end still closes or opens its slur, so its loss reaches the
  // other end, which is drawn.
  test('reports a slur end in a hidden block on the rest', () => {
    const rest = hiddenBlock('<slur type="start" number="1"/>')

    expect(kinds(rest).warnings).toEqual([['unrepresentable:element', 'slur', 1]])
  })

  test('reports a hidden block on a rest a note value writes as drawn', () => {
    const rest = hiddenBlock('<articulations><accent/></articulations>').replace('20', '16')

    expect(kinds(rest, '<time><beats>4</beats><beat-type>4</beat-type></time>')).toMatchObject({
      content: [['event']],
      warnings: [blockDrawn],
    })
  })
})

// A grace note takes none of the measure's time, so a grace rest is never the
// measure's rest, whatever it is marked as.
describe('a grace rest marked as the measure rest', () => {
  const note =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<voice>1</voice><type>quarter</type></note>'

  const lostMark = ['unsupported:attribute', 'measure']
  test.each([
    ['a stem', '<stem>up</stem>', [['missing:note-type', undefined], lostMark]],
    ['a written value', '<type>eighth</type>', [lostMark]],
  ])('converts a grace rest with %s as a grace rest, reporting the mark', (_, body, lost) => {
    const { mnx, warnings } = convertValid(
      inMeasure(`<note><grace/><rest measure="yes"/><voice>1</voice>${body}</note>${note}`),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'grace',
      'event',
    ])
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings.map((w) => [w.code, w.attribute])).toEqual(lost)
  })

  // A grace note states no <duration>. One that does states nothing the
  // measure takes from it.
  test('leaves the voice without a measure rest where the grace rest states a duration', () => {
    const { mnx } = convertValid(
      inMeasure(
        '<note><grace/><rest measure="yes"/><duration>16</duration><voice>1</voice>' +
          '<type>whole</type></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toBeUndefined()
  })
})

// MusicXML requires a <duration> on every note that is not a grace note. A
// measure rest without one lasts its written value, as any other note does.
describe('a measure rest with no duration', () => {
  const rest = '<note><rest measure="yes"/><voice>1</voice><type>quarter</type></note>'
  const grace =
    '<note><grace/><pitch><step>D</step><octave>5</octave></pitch>' +
    '<type>eighth</type><voice>1</voice></note>'

  const voiceTwo =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<voice>2</voice><type>quarter</type></note>'
  const stated = rest.replace('<voice>', '<duration>4</duration><voice>')

  test.each([
    ['alone', ''],
    ['followed by a grace note', grace],
  ])('converts as the same rest with a duration, %s', (_, after) => {
    expect(convertValid(inMeasure(rest + after + voiceTwo)).mnx).toEqual(
      convertValid(inMeasure(stated + after + voiceTwo)).mnx,
    )
  })

  // A bar of silence is drawn as a whole rest in any meter, so the rest lasts
  // the measure the time signature states, not the whole it is drawn as.
  const inThreeFour = (body: string) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type>' +
    `</time>${TREBLE}</attributes>${body}</measure></part></score-partwise>`
  const wholeRest = (body = '') =>
    `<note><rest measure="yes"/><voice>1</voice><type>whole</type>${body}</note>`
  const threeQuarters =
    '<backup><duration>12</duration></backup>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
    '<voice>2</voice><type>half</type><dot/></note>'

  test.each([
    ['on the sequence', wholeRest(), ''],
    ['kept as an event for its lyric', wholeRest('<lyric><text>la</text></lyric>'), ''],
    ['followed by a grace note', wholeRest(), grace],
  ])('lasts the measure in 3/4, %s', (_, measureRest, after) => {
    const withDuration = measureRest.replace('<voice>', '<duration>12</duration><voice>')

    expect(convertValid(inThreeFour(measureRest + after + threeQuarters)).mnx).toEqual(
      convertValid(inThreeFour(withDuration + after + threeQuarters)).mnx,
    )
  })

  // Beside a grace note the rest stays an event, drawn as the whole it is
  // written as, so the measure it lasts is reported as lost.
  test.each([
    ['before', grace + wholeRest()],
    ['after', wholeRest() + grace],
  ])('reports the whole it is drawn as in 3/4, with a grace note %s', (_, body) => {
    const withDuration = body.replace('<voice>1</voice><type>whole', '<duration>12</duration>$&')
    const { mnx, warnings } = convertValid(inThreeFour(body))
    const stated = convertValid(inThreeFour(withDuration))

    expect(mnx).toEqual(stated.mnx)
    expect(warnings.map((w) => [w.code, w.message])).toEqual(
      stated.warnings.map((w) => [w.code, w.message]),
    )
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
  })
})

// Chant editions are written senza misura, where no time signature says how
// long a measure runs. A part resting through such a measure is one rest
// carrying no <type>, often longer than any note value can write. MNX states
// a rest filling the measure on the sequence, which needs no length, so that
// is where such a rest goes.
describe('a rest with no value filling an unmeasured measure', () => {
  const unmeasured = (body: string) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions><time><senza-misura/></time></attributes>' +
    `${body}</measure></part></score-partwise>`
  const rest = (units: number) =>
    `<note><rest/><duration>${String(units)}</duration><voice>1</voice></note>`

  test('writes it as the rest of the voice’s measure', () => {
    const { mnx, warnings } = convertValid(unmeasured(rest(11)))

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:senza-misura',
      'unrepresentable:rest-length',
    ])
  })

  test('names the length it does not state', () => {
    const { warnings } = convertValid(unmeasured(rest(11)))

    expect(warnings[1]?.message).toContain('11/16 of a whole note')
  })

  // A length a note value can write needs none of this: the rest is the event
  // it is written as.
  test('leaves a rest a note value can write as an event', () => {
    const { mnx, warnings } = convertValid(unmeasured(rest(4)))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:senza-misura'])
  })

  // A <forward> moves the cursor without the voice sounding, so the rest
  // after one does not open the measure even where the voice holds nothing.
  test('refuses a rest a forward moved the cursor past', () => {
    let thrown = ''
    try {
      convertMusicXML(unmeasured('<forward><duration>4</duration></forward>' + rest(11)))
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('no note value can write')
  })

  // The rest is read as the measure's only where the source states no value
  // for it. One drawn as a whole says what it is, and the two lengths are the
  // source disagreeing with itself.
  test('leaves a rest drawn with a value an event', () => {
    const { mnx, warnings } = convertValid(
      unmeasured('<note><rest/><duration>11</duration><voice>1</voice><type>whole</type></note>'),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:senza-misura',
      'inconsistent:duration',
    ])
  })

  // With no <divisions> anywhere, the length of the duration is a guess, so it
  // cannot rest a measure.
  test('refuses where no divisions said how long the duration is', () => {
    let thrown = ''
    try {
      convertMusicXML(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><time><senza-misura/></time></attributes>' +
          rest(11) +
          '</measure></part></score-partwise>',
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('no <divisions> ever said how long its <duration> is')
  })

  // A rest reached after the voice has sounded covers what is left of the
  // measure, not the measure, and nothing says how long that is.
  test('refuses a rest the voice does not open with', () => {
    let thrown = ''
    try {
      convertMusicXML(
        unmeasured(
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
            '<type>quarter</type><voice>1</voice></note>' +
            rest(11),
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('no note value can write')
  })

  // A rest lasting exactly what the time signature states loses nothing by
  // going on the sequence, whatever note values can write: the measure says
  // how long it runs.
  test('says nothing about a rest filling an irregular measure', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions><time><beats>5</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        rest(20) +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings).toEqual([])
  })

  // A measure longer than its time signature says is the source's own
  // measure, and a hidden part rests through one with a bare rest of that
  // length. There is no event to write it as either, so it rests the measure
  // the same way, and the length is reported.
  test('rests a measure longer than its time signature', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        rest(20) +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:rest-length'])
    expect(warnings[0]?.message).toContain('no note value can write that length')
  })
})

// A rest lasting exactly the measure is the measure's rest, even where the
// source leaves measure="yes" off. It has to be where the measure begins:
// exporters fill the bar behind a note that overruns the barline with a rest
// of the measure's length, and that one rests what is left of the measure.
describe('a rest lasting exactly the measure', () => {
  const metered = (body: string) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
    `</time>${TREBLE}</attributes>${body}</measure></part></score-partwise>`
  const rest = '<note><rest/><duration>16</duration><voice>1</voice></note>'
  const overrunning =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>32</duration>' +
    '<voice>1</voice><type>breve</type></note>'

  test('rests the measure where it opens the measure', () => {
    const { mnx, warnings } = convertValid(metered(rest))

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings).toEqual([])
  })

  // A <backup> reaching further back than the measure has run writes what
  // follows at the measure start, so the rest after one opens the measure.
  test('rests the measure after a backup that reached past the start', () => {
    const { mnx, warnings } = convertValid(
      metered(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
          '<voice>1</voice><type>half</type></note>' +
          '<backup><duration>32</duration></backup>' +
          '<note><rest/><duration>16</duration><voice>2</voice></note>',
      ),
    )
    const resting = mnx.parts[0]?.measures[0]?.sequences[1]

    expect(resting?.fullMeasure).toEqual({})
    expect(resting?.content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
  })

  // A whole rest in 4/4 is drawn as long as it lasts, so nothing about it is
  // left to settle and it converts as the rest it is written as.
  test('leaves a rest drawn as long as the measure an event', () => {
    const { mnx, warnings } = convertValid(
      metered('<note><rest/><duration>16</duration><type>whole</type><voice>1</voice></note>'),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  test('leaves a rest the voice does not open with an event', () => {
    const { mnx } = convertValid(metered(overrunning + rest))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
  })
})

describe('a rest drawn shorter than the measure it fills', () => {
  // A bar of silence is drawn with a whole rest whatever the meter says, so in
  // 3/2 the drawn value is a whole and the measure lasts a dotted whole.
  const inThreeTwo = (body: string, attributes = '') =>
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions><time><beats>3</beats><beat-type>2</beat-type>' +
    `</time>${attributes}${TREBLE}</attributes>${body}</measure></part></score-partwise>`
  const wholeRest =
    '<note><rest>DISPLAY</rest><duration>24</duration><type>whole</type>NOTATIONS</note>'
  const rest = (notations = '', display = '') =>
    wholeRest.replace('NOTATIONS', notations).replace('DISPLAY', display)

  /** The sequence and warnings of a one-measure conversion, with the MNX held. */
  function convert(source: string) {
    const { mnx, warnings } = convertValid(source)
    return { mnx, sequences: mnx.parts[0]?.measures[0]?.sequences ?? [], warnings }
  }

  /** A rest the reading keeps an event: the codes reported, and the MNX legal. */
  function keptAnEvent(source: string) {
    const { sequences, warnings } = convert(source)

    expect(sequences[0]?.fullMeasure).toBeUndefined()
    return warnings.map((w) => w.code)
  }

  test('rests the measure, stating the drawn value beside it', () => {
    const { sequences, warnings } = convert(inThreeTwo(rest()))

    expect(sequences[0]?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(sequences[0]?.content).toEqual([])
    expect(warnings).toEqual([])
  })

  // MNX's full-measure rest carries a pause and a height of its own, so
  // neither keeps the rest an event.
  test('carries a fermata held over the rest', () => {
    const { sequences, warnings } = convert(inThreeTwo(rest('<notations><fermata/></notations>')))

    expect(sequences[0]?.fullMeasure).toEqual({
      visualDuration: { base: 'whole' },
      fermata: {},
    })
    expect(warnings).toEqual([])
  })

  test('carries the height the rest is pinned to', () => {
    const { sequences, warnings } = convert(
      inThreeTwo(rest('', '<display-step>D</display-step><display-octave>5</display-octave>')),
    )

    expect(sequences[0]?.fullMeasure).toMatchObject({ staffPosition: 2 })
    expect(warnings).toEqual([])
  })

  // One voice resting a measure the others sound through is the common case,
  // and only that voice's sequence becomes a rest.
  test('rests one voice of a measure the others sound through', () => {
    const { sequences, warnings } = convert(
      inThreeTwo(
        '<note><rest/><duration>24</duration><type>whole</type><voice>1</voice></note>' +
          '<backup><duration>24</duration></backup>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
          '<type>breve</type><voice>2</voice></note>',
      ),
    )

    expect(sequences[0]?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(sequences[1]?.fullMeasure).toBeUndefined()
    expect(sequences[1]?.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
  })

  test('rests each staff of a part on its own', () => {
    const staffRest = (staff: number) =>
      `<note><rest/><duration>24</duration><type>whole</type><voice>${String(staff)}</voice>` +
      `<staff>${String(staff)}</staff></note>`
    const { sequences, warnings } = convert(
      inThreeTwo(
        staffRest(1) + '<backup><duration>24</duration></backup>' + staffRest(2),
        '<staves>2</staves>',
      ),
    )

    expect(sequences.map((sequence) => sequence.staff)).toEqual([1, 2])
    expect(sequences.every((sequence) => sequence.fullMeasure !== undefined)).toBe(true)
    expect(warnings).toEqual([])
  })

  test('reports the drawn value where the rest is not the whole of its voice', () => {
    const codes = keptAnEvent(
      inThreeTwo(
        rest() +
          '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>eighth</type></note>',
      ),
    )

    expect(codes).toEqual(['inconsistent:duration'])
  })

  test('reports the drawn value where the rest stands, before what follows it', () => {
    const codes = keptAnEvent(
      inThreeTwo(
        rest() +
          '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>eighth</type>' +
          '<notations><other-notation type="single"/></notations></note>',
      ),
    )

    expect(codes).toEqual(['inconsistent:duration', 'unsupported:element'])
  })

  // A grace note takes none of the measure's time, so a rest written as one
  // never fills the measure, and the report stays where it is written.
  test('leaves a rest written as a grace note alone', () => {
    const codes = keptAnEvent(inThreeTwo(rest().replace('<note>', '<note><grace/>')))

    expect(codes).toEqual(['inconsistent:duration'])
  })

  // With no <divisions> the duration is read against an assumed one, so
  // nothing knows the rest lasts the measure.
  test('leaves a rest an event where nothing said how long a division is', () => {
    const { warnings } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><time><beats>3</beats><beat-type>2</beat-type></time>' +
        `${TREBLE}</attributes>${rest()}</measure></part></score-partwise>`,
    )

    expect(warnings.map((w) => w.code)).toContain('missing:divisions')
    expect(warnings.map((w) => w.code)).toContain('inconsistent:duration')
  })

  test('keeps a rest carrying a marking an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest('<notations><articulations><staccato/></articulations></notations>')),
    )

    expect(codes).toEqual(['inconsistent:duration'])
  })

  test('keeps a rest drawn with a stem an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest().replace('<type>whole</type>', '<type>whole</type><stem>down</stem>')),
    )

    expect(codes).toEqual(['inconsistent:duration'])
  })

  test('keeps a rest drawn under a beam an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest().replace('</note>', '<beam number="1">begin</beam></note>')),
    )

    expect(codes).toEqual(['inconsistent:duration'])
  })

  test('keeps a rest marked as rolled an event', () => {
    const { sequences, warnings } = convert(
      inThreeTwo(rest('<notations><arpeggiate/></notations>')),
    )

    expect(sequences[0]?.fullMeasure).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration', 'unsupported:element'])
    // A roll runs between notes, and a rest has none. It is not a chord on a
    // kit, which has notes but no pitches to order them by.
    expect(warnings[1]?.message).toContain('A rest is marked as rolled')
  })

  test('rests the measure beside a chord another voice rolls', () => {
    const rolledNote = (step: string, chord: string) =>
      `<note>${chord}<pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>24</duration><voice>2</voice><type>whole</type><dot/>' +
      '<notations><arpeggiate/></notations></note>'
    const { sequences, warnings } = convert(
      inThreeTwo(
        rest().replace('</note>', '<voice>1</voice></note>') +
          '<backup><duration>24</duration></backup>' +
          rolledNote('C', '') +
          rolledNote('E', '<chord/>'),
      ),
    )

    expect(sequences[0]?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(warnings).toEqual([])
  })

  test('keeps a rest a slur reaches an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest('<notations><slur type="start" number="1"/></notations>')),
    )

    expect(codes).toEqual(['inconsistent:duration', 'unclosed:spanner'])
  })

  test('keeps a rest an event where its slur shares the notations with a fermata', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest('<notations><fermata/><slur type="start" number="1"/></notations>')),
    )

    expect(codes).toEqual(['inconsistent:duration', 'unclosed:spanner'])
  })

  // The measure rest stands and the extra is discarded, but the extra still
  // disagreed with itself, and that disagreement is reported where it stands.
  test('reports the drawn value of a rest written over the measure rest', () => {
    const { warnings } = convert(
      inThreeTwo(
        '<note><rest measure="yes"/><duration>24</duration></note>' +
          '<backup><duration>24</duration></backup>' +
          rest(),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration', 'redundant:rest'])
  })

  test('keeps a rest carrying a lyric an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest().replace('</note>', '<lyric><text>ah</text></lyric></note>')),
    )

    expect(codes).toEqual(['inconsistent:duration'])
  })
})

// A rest the source marks as the measure's is the measure's rest only where
// it is the whole of its voice. Early-music editions bar their parts at
// different lengths and pad a voice with a marked whole rest before or after
// the notes it sings.
// Where the source states the value the rest is drawn as, the rest can stand
// as an ordinary event, so which reading holds waits until the voice is whole.
describe("a rest marked as the measure's standing beside other notes", () => {
  const marked =
    '<note><rest measure="yes"/><duration>16</duration><type>whole</type>' +
    '<voice>1</voice></note>'
  const note = (duration: number, value: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><type>${value}</type><voice>1</voice></note>`

  test('keeps the rest an event where the voice has already sounded', () => {
    const { mnx, warnings } = convertValid(inMeasure(note(8, 'half') + marked))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  test('keeps the rest an event where notes follow it', () => {
    const { mnx, warnings } = convertValid(inMeasure(marked + note(4, 'quarter')))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A voice running past its time signature is how the source bars it, and
  // both events carry over as written, so nothing is lost and nothing is
  // reported. A plain whole note and a quarter in 4/4 convert the same way.
  test('keeps both events where a rest carrying a lyric overruns the measure', () => {
    const withLyric = marked.replace('</note>', '<lyric><text>ah</text></lyric></note>')
    const quarterRest =
      '<note><rest/><duration>4</duration><type>quarter</type><voice>1</voice></note>'
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          withLyric +
          quarterRest,
      ),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toMatchObject([
      { duration: { base: 'whole' }, rest: {}, lyrics: { lines: { '1': { text: 'ah' } } } },
      { duration: { base: 'quarter' }, rest: {} },
    ])
    expect(warnings).toEqual([])
  })

  test('rests the measure where the rest is the whole of the voice', () => {
    const { mnx, warnings } = convertValid(inMeasure(marked))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(sequence?.content).toEqual([])
    expect(warnings).toEqual([])
  })

  // Without a written value there is no event for the rest to fall back to,
  // so the mark is taken as written and the voice cannot hold both.
  test('refuses where the source states no value to draw the rest as', () => {
    let thrown = ''
    try {
      convertMusicXML(
        inMeasure(
          note(8, 'half') +
            '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
  })
})
