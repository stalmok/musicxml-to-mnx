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
    const { item } = firstEvent(
      inMeasure('<note><rest/><duration>4</duration><type>quarter</type></note>'),
    )

    expect(item).toMatchObject({ isRest: true, staffPosition: undefined })
  })

  test('writes a rest position the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure(displayRest('G', 4)))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event).toMatchObject({ rest: { staffPosition: -2 } })
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A rest that fills its measure becomes MNX's full-measure rest, which has
  // no staffPosition, so a height on one cannot be carried and is reported.
  test('reports a display height on a rest that fills its measure', () => {
    const { warnings } = firstEvent(
      inMeasure(
        '<note><rest measure="yes"><display-step>G</display-step>' +
          '<display-octave>4</display-octave></rest><duration>4</duration></note>',
      ),
    )

    expect(warnings.map((w) => w.element)).toEqual(['display-step'])
    expect(warnings[0]?.message).toContain('fills its measure')
  })
})
