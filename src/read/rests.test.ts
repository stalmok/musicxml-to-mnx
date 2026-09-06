// A rest can be pinned to a height on the staff with <display-step> and
// <display-octave>, read against the clef in force. MNX states that height as
// rest.staffPosition, staff steps from the middle line, the same count the
// clef itself is placed by.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

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
    const { mnx } = convertMusicXML(inMeasure(displayRest('G', 4)))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event).toMatchObject({ rest: { staffPosition: -2 } })
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx } = convertMusicXML(
      inMeasure(
        '<note><rest measure="yes"><display-step>G</display-step>' +
          '<display-octave>4</display-octave></rest><duration>4</duration></note>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({ staffPosition: -2 })
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// MNX states a rest that fills a measure on the sequence, not as an event in
// it, so the voice's sequence is where that rest is written. A sequence whose
// content is empty is therefore the rest itself, not one left over: the
// vendored corpus writes 11,082 of them, and dropping any would drop a rest.
describe('a voice holding only a rest that fills its measure', () => {
  test('writes the rest on a sequence with no content', () => {
    const { mnx, warnings } = convertMusicXML(
      inMeasure('<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'),
    )

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // The resting voice sits beside a sounding one, which is where leaving the
  // sequence out would be visible: the measure would say the voice is not
  // there rather than that it rests through.
  test('keeps the resting voice beside a sounding one', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// A grace note takes none of the measure's time, so a voice leading into a
// measure of silence with one rests through it just the same. MNX wants the
// sequence stating a full-measure rest to hold nothing, so the rest is
// written as the event its length has a value for and the grace notes stand
// beside it. Real editions write the pair: an editorial grace note over a
// resting bar opens three CPDL scores.
describe('a rest filling a measure a grace note leads into', () => {
  const grace =
    '<note><grace/><pitch><step>D</step><octave>5</octave></pitch>' +
    '<type>quarter</type><voice>1</voice></note>'
  const measureRest = '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>'

  test('writes the rest as an event beside the grace notes', () => {
    const { mnx, warnings } = convertMusicXML(inMeasure(grace + measureRest))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'grace',
      'event',
    ])
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('states the rest with the value its length is written as', () => {
    const { mnx } = convertMusicXML(inMeasure(grace + measureRest))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[1]

    expect(event && !('type' in event) && event.duration).toEqual({ base: 'quarter' })
    expect(event && !('type' in event) && event.rest).toEqual({})
  })

  // Nothing is different where the voice holds no grace note: the rest is
  // still the sequence's own.
  test('leaves a rest with no grace note before it on the sequence', () => {
    const { mnx } = convertMusicXML(inMeasure(measureRest))

    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
  })

  // An irregular measure has no note value to write the rest as, so there is
  // nothing to make an event of and the refusal stands.
  test('refuses where no note value can write the measure', () => {
    let thrown = ''
    try {
      convertMusicXML(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>4</divisions><time><beats>5</beats><beat-type>4</beat-type>' +
          '</time></attributes>' +
          grace +
          '<note><rest measure="yes"/><duration>20</duration><voice>1</voice></note>' +
          '</measure></part></score-partwise>',
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
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
    const { mnx, warnings } = convertMusicXML(unmeasured(rest(11)))

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:senza-misura',
      'unrepresentable:rest-length',
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('names the length it does not state', () => {
    const { warnings } = convertMusicXML(unmeasured(rest(11)))

    expect(warnings[1]?.message).toContain('11/16 of a whole note')
  })

  // A length a note value can write needs none of this: the rest is the event
  // it is written as, and how long the measure runs is nobody's guess.
  test('leaves a rest a note value can write as an event', () => {
    const { mnx, warnings } = convertMusicXML(unmeasured(rest(4)))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:senza-misura'])
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

  // A time signature states how long the measure runs, so a rest there is
  // weighed against it as before.
  test('leaves a measured rest to the time signature', () => {
    let thrown = ''
    try {
      convertMusicXML(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
          '</time></attributes>' +
          rest(11) +
          '</measure></part></score-partwise>',
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('no note value can write')
  })
})
