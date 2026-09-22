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

// A <backup> reaching back further than the measure has run is reported where
// the music after it is written, which for a rest filling the measure is the
// rest itself.
describe('a measure rest written after a backup past the measure start', () => {
  test('reports the reach and writes the rest at the measure start', () => {
    const { mnx, warnings } = convertMusicXML(
      inMeasure(
        '<backup><duration>8</duration></backup>' +
          '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>',
      ),
    )

    expect(warnings.map((warning) => warning.code)).toEqual(['inconsistent:backup'])
    expect(mnx.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toEqual({})
    expect(schemaErrors(mnx)).toEqual([])
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

  // A grace note over a resting bar is as often written after the rest as
  // before it, and leads into the next measure's downbeat either way. Which
  // side of the rest it is written on is settled while the rest is being
  // read, so a rest already on the sequence goes back to being the event its
  // length is written as.
  test('writes the rest as an event where the grace notes follow it', () => {
    const { mnx, warnings } = convertMusicXML(inMeasure(measureRest + grace))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content.map((item) => ('type' in item ? item.type : 'event'))).toEqual([
      'event',
      'grace',
    ])
    expect(sequence?.fullMeasure).toBeUndefined()
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('states the rest that follows the grace notes with its own value', () => {
    const { mnx } = convertMusicXML(inMeasure(measureRest + grace))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && !('type' in event) && event.duration).toEqual({ base: 'quarter' })
    expect(event && !('type' in event) && event.rest).toEqual({})
  })

  // The rest goes back to where it stands, not to where the cursor has since
  // reached. A <backup> written over it takes the voice to the measure start,
  // and what follows there is a second line of the voice rather than music
  // written after the rest.
  test('writes the restored rest where it stands', () => {
    const { mnx } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A voice that rests one line of the measure can sound another. The rest
  // is the first line's, so a grace note in the line the voice is sounding
  // stands there and leaves the rest where it is.
  test('leaves a measure rest in another line of the voice alone', () => {
    const { mnx } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A bracket the grace note itself opens starts at the grace note, so the
  // rest stands outside it. The rest is taken back before the bracket opens,
  // which is why it does. The same two written the other way round are
  // refused, because there the bracket does reach the rest.
  test('leaves the restored rest outside a bracket the grace note opens', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A <forward> before the rest is silence the voice passed over, and MNX
  // states it as a space. The rest is written back where it stands, so the
  // space before it stands too.
  test('keeps the silence the source passed over before the rest', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
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
  // nothing to make an event of and the refusal stands, whichever side of the
  // rest the grace notes are written on.
  const irregular = (body: string) =>
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions><time><beats>5</beats><beat-type>4</beat-type>' +
    '</time></attributes>' +
    body +
    '</measure></part></score-partwise>'
  const irregularRest = '<note><rest measure="yes"/><duration>20</duration><voice>1</voice></note>'

  test('refuses where no note value can write the measure', () => {
    let thrown = ''
    try {
      convertMusicXML(irregular(grace + irregularRest))
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
  })

  test('refuses grace notes after a rest no note value can write', () => {
    let thrown = ''
    try {
      convertMusicXML(irregular(irregularRest + grace))
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('no note value can write that rest as an event')
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
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx, warnings } = convertMusicXML(
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
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A measure longer than its time signature says is the source's own
  // measure, and a hidden part rests through one with a bare rest of that
  // length. There is no event to write it as either, so it rests the measure
  // the same way, and the length is reported.
  test('rests a measure longer than its time signature', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx, warnings } = convertMusicXML(metered(rest))

    expect(mnx.parts[0]?.measures[0]?.sequences).toEqual([
      { voice: '1', content: [], fullMeasure: {} },
    ])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A <backup> reaching further back than the measure has run writes what
  // follows at the measure start, so the rest after one opens the measure.
  test('rests the measure after a backup that reached past the start', () => {
    const { mnx, warnings } = convertMusicXML(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A whole rest in 4/4 is drawn as long as it lasts, so nothing about it is
  // left to settle and it converts as the rest it is written as.
  test('leaves a rest drawn as long as the measure an event', () => {
    const { mnx, warnings } = convertMusicXML(
      metered('<note><rest/><duration>16</duration><type>whole</type><voice>1</voice></note>'),
    )
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(1)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('leaves a rest the voice does not open with an event', () => {
    const { mnx } = convertMusicXML(metered(overrunning + rest))
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
    const { mnx, warnings } = convertMusicXML(source)
    return { mnx, sequences: mnx.parts[0]?.measures[0]?.sequences ?? [], warnings }
  }

  /** A rest the reading keeps an event: the codes reported, and the MNX legal. */
  function keptAnEvent(source: string) {
    const { mnx, sequences, warnings } = convert(source)

    expect(sequences[0]?.fullMeasure).toBeUndefined()
    expect(schemaErrors(mnx)).toEqual([])
    return warnings.map((w) => w.code)
  }

  test('rests the measure, stating the drawn value beside it', () => {
    const { mnx, sequences, warnings } = convert(inThreeTwo(rest()))

    expect(sequences[0]?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(sequences[0]?.content).toEqual([])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // MNX's full-measure rest carries a pause and a height of its own, so
  // neither keeps the rest an event.
  test('carries a fermata held over the rest', () => {
    const { mnx, sequences, warnings } = convert(
      inThreeTwo(rest('<notations><fermata/></notations>')),
    )

    expect(sequences[0]?.fullMeasure).toEqual({
      visualDuration: { base: 'whole' },
      fermata: {},
    })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('carries the height the rest is pinned to', () => {
    const { mnx, sequences, warnings } = convert(
      inThreeTwo(rest('', '<display-step>D</display-step><display-octave>5</display-octave>')),
    )

    expect(sequences[0]?.fullMeasure).toMatchObject({ staffPosition: 2 })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  // One voice resting a measure the others sound through is the common case,
  // and only that voice's sequence becomes a rest.
  test('rests one voice of a measure the others sound through', () => {
    const { mnx, sequences, warnings } = convert(
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
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('rests each staff of a part on its own', () => {
    const staffRest = (staff: number) =>
      `<note><rest/><duration>24</duration><type>whole</type><voice>${String(staff)}</voice>` +
      `<staff>${String(staff)}</staff></note>`
    const { mnx, sequences, warnings } = convert(
      inThreeTwo(
        staffRest(1) + '<backup><duration>24</duration></backup>' + staffRest(2),
        '<staves>2</staves>',
      ),
    )

    expect(sequences.map((sequence) => sequence.staff)).toEqual([1, 2])
    expect(sequences.every((sequence) => sequence.fullMeasure !== undefined)).toBe(true)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
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
    const { warnings } = convertMusicXML(
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
    const { mnx, warnings } = convertMusicXML(inMeasure(note(8, 'half') + marked))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('keeps the rest an event where notes follow it', () => {
    const { mnx, warnings } = convertMusicXML(inMeasure(marked + note(4, 'quarter')))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(sequence?.content).toHaveLength(2)
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('rests the measure where the rest is the whole of the voice', () => {
    const { mnx, warnings } = convertMusicXML(inMeasure(marked))
    const sequence = mnx.parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.fullMeasure).toEqual({ visualDuration: { base: 'whole' } })
    expect(sequence?.content).toEqual([])
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
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
