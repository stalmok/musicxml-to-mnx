// A piano part is one MusicXML part holding two staves, with every note
// saying which one it is on. MNX keeps the part whole too, stating the staff
// count on the part, the staff on each voice, and an override on the events
// of a voice that reaches across to the other hand.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

function note(step: string, staff: string, voice = '1'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
    `<type>quarter</type><voice>${voice}</voice><staff>${staff}</staff></note>`
  )
}

function measures(...bodies: string[]): string {
  const inner = bodies
    .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
    .join('')
  return `<score-partwise><part id="P1">${inner}</part></score-partwise>`
}

const GRAND_STAFF =
  '<attributes><divisions>4</divisions><staves>2</staves>' +
  '<clef number="1"><sign>G</sign></clef>' +
  '<clef number="2"><sign>F</sign></clef></attributes>'

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  return { part: score.parts[0], warnings: warnings.list() }
}

describe('how many staves a part has', () => {
  test('counts them from the part itself', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1')))

    expect(part?.staves).toBe(2)
  })

  test('takes a part that never says as having one', () => {
    const { part } = read(
      measures('<attributes><divisions>4</divisions></attributes>' + note('C', '1')),
    )

    expect(part?.staves).toBe(1)
  })

  test('carries the count into later measures', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1'), note('D', '2')))

    expect(part?.staves).toBe(2)
  })
})

describe('clefs', () => {
  test('places each on the staff it belongs to', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1')))

    expect(part?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -2, staff: 1, position: { num: 0, den: 1 } },
      { sign: 'F', staffPosition: 2, staff: 2, position: { num: 0, den: 1 } },
    ])
  })

  test('leaves the staff off where the part has only one', () => {
    const { part } = read(
      measures(
        '<attributes><divisions>4</divisions><clef><sign>G</sign></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs[0]?.staff).toBeUndefined()
  })

  // A clef can change partway through a measure, so each records where the
  // cursor had reached when it was declared. Without the position, the two
  // clefs of this measure would both claim its start.
  test('records where in the measure a clef change falls', () => {
    const { part } = read(
      measures(
        '<attributes><divisions>4</divisions><clef><sign>G</sign></clef></attributes>' +
          note('C', '1') +
          '<attributes><clef><sign>F</sign></clef></attributes>' +
          note('D', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs.map((clef) => clef.position)).toEqual([
      { num: 0, den: 1 },
      { num: 1, den: 4 },
    ])
  })

  // Exporters restate a staff's clef at the same point, as when the clef in
  // force is immediately replaced by one drawn after the barline. MNX draws
  // one clef at a point, so the one the following notes obey survives.
  test('keeps only the last of two clefs at the same point on one staff', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><staves>2</staves>' +
          '<clef number="1"><sign>G</sign></clef>' +
          '<clef number="2"><sign>F</sign></clef></attributes>' +
          '<attributes><clef number="2" after-barline="yes"><sign>G</sign></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -2, staff: 1, position: { num: 0, den: 1 } },
      { sign: 'G', staffPosition: -2, staff: 2, position: { num: 0, den: 1 } },
    ])
    // The replaced clef is the unrepresentable one; the kept clef's
    // after-barline drawing position is its own, separate loss, with no
    // home in MNX's clef.
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:clef',
    ])
  })

  test('keeps two clefs of one staff apart when their positions differ', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><clef><sign>G</sign></clef></attributes>' +
          note('C', '1') +
          '<attributes><clef><sign>F</sign></clef></attributes>' +
          note('D', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A treble-8 clef, drawn with an 8 below it, sits an octave lower than a
  // plain treble. MusicXML states the transposition as <clef-octave-change>.
  test('carries a clef octave change', () => {
    const { part } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' +
          '</attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs[0]?.octave).toBe(-1)
  })

  // MNX's ottava amount reaches three octaves. A larger transposition, which
  // is valid MusicXML, has no home there, so the clef is drawn at pitch and
  // the loss is reported rather than the file refused.
  test('reports a clef octave change too large for MNX and keeps the clef', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line><clef-octave-change>-4</clef-octave-change></clef>' +
          '</attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs[0]?.sign).toBe('G')
    expect(part?.measures[0]?.clefs[0]?.octave).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef-octave'])
  })
})

describe('which staff a voice is on', () => {
  test('states it on the voice', () => {
    const { part } = read(
      measures(
        GRAND_STAFF +
          note('C', '1', '1') +
          '<backup><duration>4</duration></backup>' +
          note('E', '2', '2'),
      ),
    )

    expect(part?.measures[0]?.sequences.map((s) => s.staff)).toEqual([1, 2])
  })

  test('leaves it off where the part has only one staff', () => {
    const { part } = read(
      measures('<attributes><divisions>4</divisions></attributes>' + note('C', '1')),
    )

    expect(part?.measures[0]?.sequences[0]?.staff).toBeUndefined()
  })
})

describe('a voice that reaches across to the other staff', () => {
  test('keeps the voice whole and marks the events that reach', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1') + note('D', '1') + note('E', '2')))
    const sequence = part?.measures[0]?.sequences[0]
    const staves = sequence?.content.map((item) => (item.kind === 'event' ? item.staff : null))

    // The voice belongs to the staff most of it is on; only the event that
    // reaches across says otherwise.
    expect(sequence?.staff).toBe(1)
    expect(staves).toEqual([undefined, undefined, 2])
  })

  test('takes the voice to be on the staff it spends most of its time', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1') + note('D', '2') + note('E', '2')))
    const sequence = part?.measures[0]?.sequences[0]

    expect(sequence?.staff).toBe(2)
    expect(sequence?.content.map((item) => (item.kind === 'event' ? item.staff : null))).toEqual([
      1,
      undefined,
      undefined,
    ])
  })
})

// MusicXML allows one key and one time signature per staff. MNX states them
// for the whole score, so staves that disagree cannot both be carried.
describe('key and time signatures stated per staff', () => {
  test('says nothing when every staff agrees', () => {
    const { warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><staves>2</staves>' +
          '<key number="1"><fifths>2</fifths></key>' +
          '<key number="2"><fifths>2</fifths></key></attributes>' +
          note('C', '1'),
      ),
    )

    expect(warnings).toEqual([])
  })

  test('reports staves that disagree, rather than taking the first in silence', () => {
    const { warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><staves>2</staves>' +
          '<key number="1"><fifths>2</fifths></key>' +
          '<key number="2"><fifths>-3</fifths></key></attributes>' +
          note('C', '1'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-key'])
    expect(warnings[0]?.message).toContain('one key')
  })

  // A lone numbered block is a statement for one staff that the comparison
  // above cannot see: there is no second block to disagree with, and MNX
  // applies the one signature to the whole score.
  test('reports a key stated for one staff and not the other', () => {
    const { warnings } = read(
      measures(
        GRAND_STAFF + note('C', '1'),
        '<attributes><key number="2"><fifths>3</fifths></key></attributes>' + note('D', '1'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-key'])
  })

  test('reports a time signature stated for one staff and not the other', () => {
    const { warnings } = read(
      measures(
        GRAND_STAFF + note('C', '1'),
        '<attributes><time number="2"><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
          note('D', '1'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-time'])
  })

  test('reports time signatures that disagree between staves', () => {
    const { warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><staves>2</staves>' +
          '<time number="1"><beats>4</beats><beat-type>4</beat-type></time>' +
          '<time number="2"><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note('C', '1'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:per-staff-time'])
  })
})

// A staff number that names a staff the part does not have places the music
// nowhere, and MNX's schema types it as a bare integer, so nothing downstream
// catches it. Every one is bounded here, whatever the part's staff count,
// because the count is only known once <staves> has been met: reading the
// number only when the part already has more than one staff let a note that
// came first be placed on the first staff without a word.
describe('a staff number the part does not have', () => {
  test('rejects a clef whose number is not a whole number', () => {
    let thrown = ''
    try {
      read(
        measures(
          '<attributes><divisions>4</divisions><staves>2</staves>' +
            '<clef number="oops"><sign>G</sign></clef></attributes>' +
            note('C', '1'),
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('"oops"')
    expect(thrown).toContain('not a whole number')
  })

  test('rejects a clef on a staff beyond the part', () => {
    let thrown = ''
    try {
      read(
        measures(
          '<attributes><divisions>4</divisions><staves>2</staves>' +
            '<clef number="3"><sign>G</sign></clef></attributes>' +
            note('C', '1'),
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('outside the range 1 to 2')
  })

  test('rejects a note naming a staff before <staves> said the part had one', () => {
    let thrown = ''
    try {
      read(measures('<attributes><divisions>4</divisions></attributes>' + note('C', '2')))
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('outside the range 1 to 1')
  })

  test('says nothing about a note naming the only staff there is', () => {
    const { part, warnings } = read(
      measures('<attributes><divisions>4</divisions></attributes>' + note('C', '1')),
    )

    expect(part?.staves).toBe(1)
    expect(warnings).toEqual([])
  })
})

// A chord straddling the two hands is ordinary piano writing: the notes are
// struck together and drawn on both staves. MNX states the staff on the event
// and, where a note of it reaches across, on that note.
describe('a chord that straddles the two staves', () => {
  const chorded = (step: string, staff: string) =>
    `<note><chord/><pitch><step>${step}</step><octave>3</octave></pitch>` +
    `<duration>4</duration><type>quarter</type><voice>1</voice><staff>${staff}</staff></note>`

  test('carries the staff of the note that reaches across', () => {
    const { part, warnings } = read(measures(GRAND_STAFF + note('C', '1') + chorded('C', '2')))
    const event = part?.measures[0]?.sequences[0]?.content[0]

    expect(event?.kind === 'event' ? event.notes.map((n) => n.staff) : []).toEqual([undefined, 2])
    expect(warnings).toEqual([])
  })

  test('writes the reaching note staff onto schema-valid MNX', () => {
    const { mnx, warnings } = convertMusicXML(
      measures(GRAND_STAFF + note('C', '1') + chorded('C', '2')),
    )
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'notes' in event ? event.notes?.map((n) => n.staff) : []).toEqual([
      undefined,
      2,
    ])
    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings).toEqual([])
  })

  test('says nothing on the notes of a chord that stays on one staff', () => {
    const { part, warnings } = read(measures(GRAND_STAFF + note('C', '1') + chorded('E', '1')))
    const event = part?.measures[0]?.sequences[0]?.content[0]

    expect(event?.kind === 'event' ? event.notes.map((n) => n.staff) : []).toEqual([
      undefined,
      undefined,
    ])
    expect(warnings).toEqual([])
  })
})
