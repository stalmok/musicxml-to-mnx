// A rest can be pinned to a height on the staff with <display-step> and
// <display-octave>, read against the clef in force. MNX states that height as
// rest.staffPosition, staff steps from the middle line, the same count the
// clef itself is placed by.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
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
  const score = readScore(parseXmlRoot(source), warnings)
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
    const score = readScore(
      parseXmlRoot(
        inMeasure(
          '<note><pitch><step>C</step><octave>4</octave></pitch>' +
            '<duration>4</duration><type>quarter</type></note>' +
            '<attributes><clef><sign>F</sign><line>4</line></clef></attributes>' +
            displayRest('D', 3),
        ),
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

  // A height needs both halves to place. A rest stating one of them is not a
  // plain rest, so it is reported rather than passed over: the source meant
  // to put it somewhere, and where is what cannot be worked out.
  test.each([
    ['a step and no octave', '<display-step>G</display-step>'],
    ['an octave and no step', '<display-octave>4</display-octave>'],
  ])('reports a rest stating %s', (_what, half) => {
    const { item, warnings } = firstEvent(
      inMeasure(`<note><rest>${half}</rest><duration>4</duration><type>quarter</type></note>`),
    )

    expect(item).toMatchObject({ isRest: true, staffPosition: undefined })
    expect(warnings.map((w) => w.element)).toEqual(['display-step'])
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
    const score = readScore(parseXmlRoot(source), warnings)

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
// it, so the voice's sequence is where that rest is written. A sequence whose
// content is empty is therefore the rest itself, not one left over: the
// vendored corpus writes 11,082 of them, and dropping any would drop a rest.
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
  // rather than weighed once the voice is whole.
  test('writes a marked rest stating no <duration> on the sequence', () => {
    const { mnx } = convertValid(
      inMeasure('<note><rest measure="yes"/><type>whole</type><voice>1</voice></note>'),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: { visualDuration: { base: 'whole' } } },
    ])
  })

  // The resting voice sits beside a sounding one, which is where leaving the
  // sequence out would be visible: the measure would say the voice is not
  // there rather than that it rests through.
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

  test('reports a stem of none once on a rest a marking keeps an event', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice><stem>none</stem>' +
          '<notations><articulations><accent/></articulations></notations></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.content).toEqual([
      { duration: { base: 'quarter' }, rest: {}, markings: { accent: {} } },
    ])
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:stem-direction'])
  })

  test('reports a stem of none on a rest left on the sequence', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice>' +
          '<stem>none</stem></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:stem-direction'])
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
      ['unsupported:element', 'stem'],
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
      ['unsupported:element', 'articulations'],
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

  // A rest that states its value is weighed once the voice is whole, so notes
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

// A voice can rest its measure in one line and sing in another laid over it.
// A rest among that line's notes is part of its music, not silence over the
// measure rest.
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
// measure of silence with one rests through it just the same. MNX wants the
// sequence stating a full-measure rest to hold nothing, so the rest is
// written as the event its length has a value for and the grace notes stand
// beside it. Real editions write the pair: an editorial grace note over a
// resting bar opens three CPDL scores. Which side of the rest the grace notes
// are written on says nothing about the music, so both orders convert to the
// same thing.
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
  // before it, and leads into the next measure's downbeat either way. Which
  // side of the rest it is written on is settled while the rest is being
  // read, so a rest already on the sequence goes back to being the event its
  // length is written as.
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

  // The rest goes back to where it stands, not to where the cursor has since
  // reached. A <backup> written over it takes the voice to the measure start,
  // and what follows there is a second line of the voice rather than music
  // written after the rest.
  test('writes the restored rest where it stands', () => {
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
      mnx.parts[0]?.measures[0]?.sequences.map((sequence) =>
        sequence.content.map((item) => ('type' in item ? item.type : 'event')),
      ),
    ).toEqual([['event'], ['grace', 'event']])
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

  // A bracket the grace note itself opens starts at the grace note, so the
  // rest stands outside it. The rest is taken back before the bracket opens,
  // which is why it does. The same two written the other way round are
  // refused, because there the bracket does reach the rest.
  test('leaves the restored rest outside a bracket the grace note opens', () => {
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

  // A <forward> before the rest is silence the voice passed over, and MNX
  // states it as a space. The rest is written back where it stands, so the
  // space before it stands too.
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

  test('reports a stem of none on the rest the grace notes follow', () => {
    const { warnings } = convertValid(
      inMeasure(stemmedRest.replace('<stem>up</stem>', '<stem>none</stem>') + grace),
    )

    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:stem-direction'])
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

  // The space stands between the chord member and the grace note before the
  // rest, and a space is not a note to join.
  test.each([
    ['a grace note', graceMember],
    [
      'a full note',
      '<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>20</duration>' +
        '<voice>1</voice></note>',
    ],
  ])('refuses %s marked as a chord straight after the rest', (_, member) => {
    expect(refusal(grace + irregularRest + member)).toContain(
      'marked as a chord with no note for it to join',
    )
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
  // it is written as, and how long the measure runs is nobody's guess.
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

  // With no <divisions> anywhere, how long the duration runs is a guess, and
  // a guessed length is not one to rest a measure on.
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

  test('keeps a rest a slur reaches an event', () => {
    const codes = keptAnEvent(
      inThreeTwo(rest('<notations><slur type="start" number="1"/></notations>')),
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
// different lengths and pad a voice with a marked whole rest beside the notes
// it sings; ten CPDL scores write one, some before the notes and some after.
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
