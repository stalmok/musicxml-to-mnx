// An octave shift: a stretch of music drawn an octave or more from where it
// sounds, to keep it off the ledger lines.
//
// The sign is the one thing here that is easy to get backwards, and the two
// specifications say it in opposite terms. MusicXML's type is which way the
// notes were moved to get them onto the staff, so 8va, where the music sounds
// higher than it is drawn, is a shift "down". MNX's value is how far the
// written pitch sits below the sounded one, so the same 8va is a positive 1.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

const NOTE =
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
  '<type>quarter</type></note>'

function read(...bodies: string[]) {
  const warnings = new WarningCollector()
  const measures = bodies
    .map(
      (body, index) =>
        `<measure number="${String(index + 1)}">` +
        (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
        `${body}</measure>`,
    )
    .join('')
  const score = readScore(
    parseXmlRoot(`<score-partwise><part id="P1">${measures}</part></score-partwise>`),
    warnings,
  )
  return {
    ottavas: (score.parts[0]?.measures ?? []).map((m) => m.ottavas),
    warnings: warnings.list(),
  }
}

const shift = (type: string, size = '8', extra = '') =>
  `<direction><direction-type><octave-shift type="${type}" size="${size}" number="1"/>` +
  `</direction-type>${extra}</direction>`

describe('which way an octave shift goes', () => {
  // 8va: the music sounds higher than it is drawn, so the written pitch is an
  // octave below the sounded one, which MNX states as a positive 1.
  test('reads a MusicXML shift "down" as a positive value, which is 8va', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE + shift('stop'))

    expect(ottavas[0]?.[0]?.value).toBe(1)
    expect(warnings).toEqual([])
  })

  // 8vb: the music sounds lower than it is drawn.
  test('reads a MusicXML shift "up" as a negative value, which is 8vb', () => {
    const { ottavas } = read(shift('up') + NOTE + shift('stop'))

    expect(ottavas[0]?.[0]?.value).toBe(-1)
  })

  test.each([
    ['8', 1],
    ['15', 2],
    ['22', 3],
  ])('reads a size of %s as %i octaves', (size, octaves) => {
    const { ottavas } = read(shift('down', size) + NOTE + shift('stop'))

    expect(ottavas[0]?.[0]?.value).toBe(octaves)
  })

  test('takes a shift that states no size as one octave', () => {
    const { ottavas } = read(
      '<direction><direction-type><octave-shift type="down"/></direction-type></direction>' +
        NOTE +
        shift('stop'),
    )

    expect(ottavas[0]?.[0]?.value).toBe(1)
  })

  test('reads the side the shift is drawn on', () => {
    const { ottavas } = read(
      '<direction placement="above"><direction-type><octave-shift type="down" number="1"/>' +
        '</direction-type></direction>' +
        NOTE +
        shift('stop'),
    )

    expect(ottavas[0]?.[0]?.orient).toBe('above')
  })

  test('writes the side the shift is drawn on onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        '<direction placement="above"><direction-type>' +
        '<octave-shift type="down" size="8" number="1"/></direction-type></direction>' +
        NOTE +
        shift('stop') +
        '</measure></part></score-partwise>',
    )

    expect(JSON.stringify(mnx)).toContain('"orient":"above"')
    expect(schemaErrors(mnx)).toEqual([])
  })
})

describe('where an octave shift runs', () => {
  // MNX states the end as the place of the last event the shift covers.
  // MusicXML writes the stop after that event, so the cursor has already
  // moved past it: the stop below sits at a quarter into the second measure,
  // and the note it covers begins at the start of it.
  test('ends at the last event it covers, not where the stop is written', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE, NOTE + shift('stop'))

    expect(ottavas[0]).toEqual([
      {
        position: { num: 0, den: 1 },
        end: { measure: 1, position: { num: 0, den: 1 } },
        value: 1,
        staff: undefined,
      },
    ])
    expect(ottavas[1]).toEqual([])
    expect(warnings).toEqual([])
  })

  test('keeps the staff it applies to', () => {
    const { ottavas } = read(
      '<attributes><staves>2</staves></attributes>' +
        shift('down', '8', '<staff>2</staff>') +
        NOTE +
        shift('stop'),
    )

    expect(ottavas[0]?.[0]?.staff).toBe(2)
  })

  // MNX requires a shift to say where it stops, so unlike a hairpin, one the
  // source never closed cannot be written at all.
  test('drops one that nothing closes, and says so', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE)

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
    expect(warnings[0]?.message).toContain('nothing ends it')
  })

  test('reports a stop where none had started', () => {
    const { ottavas, warnings } = read(NOTE + shift('stop'))

    expect(ottavas[0]).toEqual([])
    expect(warnings[0]?.message).toContain('none had started')
  })

  // The same trap as a hairpin: a measure with two voices is written one
  // voice at a time, so a stop can be written before the start it belongs to.
  test('pairs the ends the music has together, not the ones written together', () => {
    // Voice 1 fills the measure with two quarters; voice 2, written after the
    // backup, is a half note. Both lines name their voice, so neither trips the
    // unnamed-voice warning.
    const voiceOne =
      '<note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>quarter</type></note>'
    const { ottavas, warnings } = read(
      voiceOne +
        voiceOne +
        shift('stop') +
        '<backup><duration>8</duration></backup>' +
        shift('down') +
        '<note><voice>2</voice><pitch><step>E</step><octave>4</octave></pitch>' +
        '<duration>8</duration><type>half</type></note>',
    )

    expect(ottavas[0]).toEqual([
      {
        position: { num: 0, den: 1 },
        // The stop is written at the halfway point; the last event it covers
        // is the quarter note beginning a quarter in.
        end: { measure: 0, position: { num: 1, den: 4 } },
        value: 1,
        staff: undefined,
      },
    ])
    expect(warnings).toEqual([])
  })

  // A shift whose stop has no event before it in its measure has nothing
  // nearer to point at than the stop's own place.
  test('falls back to where the stop is written where nothing precedes it', () => {
    const { ottavas } = read(shift('down') + NOTE, shift('stop') + NOTE)

    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 1, position: { num: 0, den: 1 } })
  })

  test('says nothing about a point partway along one', () => {
    const { warnings } = read(shift('down') + NOTE, shift('continue') + NOTE + shift('stop'))

    expect(warnings).toEqual([])
  })

  test('reports a size MNX has no value for', () => {
    const { ottavas, warnings } = read(shift('down', '9') + NOTE)

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
  })

  test('reports one that states no type at all', () => {
    const { warnings } = read(
      '<direction><direction-type><octave-shift/></direction-type></direction>' + NOTE,
    )

    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
    expect(warnings[0]?.message).toContain('of type ""')
  })

  test('reports a type it does not know', () => {
    const { warnings } = read(shift('sideways') + NOTE)

    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
  })
})
