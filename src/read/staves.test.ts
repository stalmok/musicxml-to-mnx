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

  // The sign alone does not say which clef it is. A G clef on the first line
  // is a French violin clef and a G clef on the second is a treble; the two
  // put every note a step apart.
  test('keeps only the last of two clefs of one sign drawn on different lines', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line></clef>' +
          '<clef><sign>G</sign><line>1</line></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -4, staff: undefined, position: { num: 0, den: 1 } },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef'])
  })

  // Nor does where it sits alone: a G clef on the second line and an F clef
  // on the second line are drawn in the same place and read a tenth apart.
  test('keeps only the last of two clefs drawn in one place under different signs', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line></clef>' +
          '<clef><sign>F</sign><line>2</line></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs).toEqual([
      { sign: 'F', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 } },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef'])
  })

  // Nor does where it sits: a treble clef and a treble clef sounding an
  // octave down are drawn in the same place and read an octave apart.
  test('keeps only the last of two clefs alike but for their octave', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line></clef>' +
          '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' +
          '</attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs[0]?.octave).toBe(-1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef'])
  })

  // Restating the same clef at the same point loses nothing: the two say the
  // same thing, so the second is dropped without a word. Reporting it called
  // a lossless conversion a permanent limit of the format.
  test('says nothing where a staff restates the clef it already has', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef><sign>G</sign><line>2</line></clef>' +
          '<clef><sign>G</sign><line>2</line></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs).toEqual([
      { sign: 'G', staffPosition: -2, staff: undefined, position: { num: 0, den: 1 } },
    ])
    expect(warnings).toEqual([])
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

  // Three octaves either way is the last transposition MNX states, so both
  // edges are stated and so is just outside each.
  const transposed = (change: string) =>
    '<attributes><divisions>4</divisions>' +
    `<clef><sign>G</sign><line>2</line><clef-octave-change>${change}</clef-octave-change></clef>` +
    '</attributes>' +
    note('C', '1')

  test.each(['3', '-3'])('carries a clef transposed by %s octaves', (change) => {
    const { part, warnings } = read(measures(transposed(change)))

    expect(part?.measures[0]?.clefs[0]?.octave).toBe(Number(change))
    expect(warnings).toEqual([])
  })

  test('reports a clef transposed by four octaves upward', () => {
    const { part, warnings } = read(measures(transposed('4')))

    expect(part?.measures[0]?.clefs[0]?.octave).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef-octave'])
  })

  // A clef's "number" names the staff it belongs to, which is only worth
  // stating where the part has more than one. A one-staff part stating it
  // says nothing the part does not already say.
  test('states no staff on a clef of a one-staff part, number or no number', () => {
    const { part, warnings } = read(
      measures(
        '<attributes><divisions>4</divisions>' +
          '<clef number="1"><sign>G</sign><line>2</line></clef></attributes>' +
          note('C', '1'),
      ),
    )

    expect(part?.measures[0]?.clefs[0]?.staff).toBeUndefined()
    expect(warnings).toEqual([])
  })
})

// MNX states three clef signs, C, F and G. A TAB, jianpu or "none" clef has
// no home there, and the part it heads is otherwise ordinary music, so the
// sign is reported and the rest of the part converted. A percussion clef is
// written as the treble clef the staff is read against, drawn with the glyph
// MNX's clef carries for exactly this.
describe('a clef whose sign MNX does not state', () => {
  const withSign = (sign: string, line = '') =>
    measures(
      `<attributes><divisions>4</divisions><clef><sign>${sign}</sign>${line}</clef></attributes>` +
        note('C', '1'),
    )

  test.each(['TAB', 'jianpu', 'none'])('reports a %s clef and converts the part', (sign) => {
    const { part, warnings } = read(withSign(sign))

    expect(part?.measures[0]?.clefs).toEqual([])
    expect(part?.measures[0]?.sequences[0]?.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef-sign'])
    expect(warnings[0]?.element).toBe('clef')
  })

  test('names the sign it could not state', () => {
    const { warnings } = read(withSign('TAB'))

    expect(warnings[0]?.message).toContain('TAB')
  })

  test('writes a percussion clef stating no line as the treble clef with the glyph', () => {
    const { part, warnings } = read(withSign('percussion'))

    expect(part?.measures[0]?.clefs).toEqual([
      {
        sign: 'G',
        staffPosition: -2,
        staff: undefined,
        position: { num: 0, den: 1 },
        octave: undefined,
        glyph: 'unpitchedPercussionClef1',
      },
    ])
    expect(warnings).toEqual([])
  })

  // A percussion staff may have more than the five lines a pitched staff has,
  // so a line outside 1 to 5 is drawn where it says rather than refused.
  test('converts a percussion clef drawn on a line no pitched staff has', () => {
    const { part, warnings } = read(withSign('percussion', '<line>6</line>'))

    expect(part?.measures[0]?.clefs[0]?.staffPosition).toBe(6)
    expect(warnings).toEqual([])
  })

  test('writes a percussion clef as the treble clef with the percussion glyph', () => {
    const { part, warnings } = read(withSign('percussion', '<line>2</line>'))

    expect(part?.measures[0]?.clefs).toEqual([
      {
        sign: 'G',
        staffPosition: -2,
        staff: undefined,
        position: { num: 0, den: 1 },
        octave: undefined,
        glyph: 'unpitchedPercussionClef1',
      },
    ])
    expect(warnings).toEqual([])
  })

  test('draws a percussion clef on the line the source states', () => {
    const { part, warnings } = read(withSign('percussion', '<line>3</line>'))

    expect(part?.measures[0]?.clefs[0]?.staffPosition).toBe(0)
    expect(warnings).toEqual([])
  })

  test('refuses a percussion clef drawn on a line that is not a number', () => {
    expect(() => read(withSign('percussion', '<line>middle</line>'))).toThrow(
      /<line> is not a whole number/,
    )
  })

  test('refuses a sign MusicXML does not state either', () => {
    expect(() => read(withSign('treble'))).toThrow(/"treble"/)
  })

  // Nothing is written for the clef, but the staff still has heights on it: a
  // rest placed by <display-step> reads against the clef in force. A sign MNX
  // cannot state is held as the plain treble clef, which is how percussion
  // parts are written and read.
  const placed = (clef: string) =>
    read(
      measures(
        `<attributes><divisions>4</divisions>${clef}</attributes>` +
          '<note><rest><display-step>C</display-step><display-octave>5</display-octave></rest>' +
          '<duration>4</duration><type>quarter</type></note>',
      ),
    ).part?.measures[0]?.sequences[0]?.content[0]

  test('places a rest by display-step as the treble clef does', () => {
    expect(placed('<clef><sign>percussion</sign><line>2</line></clef>')).toEqual(
      placed('<clef><sign>G</sign><line>2</line></clef>'),
    )
  })

  // The <line> of such a clef is where its glyph is drawn, not a reference
  // pitch: the percussion glyph is two bars, which name no note. Read as a G
  // clef's line, a percussion clef on line 3 would displace every drum in the
  // part by two steps.
  test.each(['1', '3', '5'])('places a rest the same way with the glyph on line %s', (line) => {
    expect(placed(`<clef><sign>percussion</sign><line>${line}</line></clef>`)).toEqual(
      placed('<clef><sign>percussion</sign><line>2</line></clef>'),
    )
  })

  test('places a rest the same way where the sign states no line', () => {
    expect(placed('<clef><sign>percussion</sign></clef>')).toEqual(
      placed('<clef><sign>G</sign><line>2</line></clef>'),
    )
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

  // A voice split evenly between the two hands belongs to the staff it was on
  // first, which is where the source began writing it. Either answer states
  // the same music, since every event that differs from the voice's staff
  // says so, but one of them has to be settled or the choice drifts.
  test('gives an even split to the staff the voice began on', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '2') + note('D', '1')))
    const sequence = part?.measures[0]?.sequences[0]

    expect(sequence?.staff).toBe(2)
    expect(sequence?.content.map((item) => (item.kind === 'event' ? item.staff : null))).toEqual([
      undefined,
      1,
    ])
  })

  // A grace group waits where it stands until the note it ornaments says which
  // line it belongs to, and the staff its notes are on moves with it: left
  // behind, it would count towards the staff of the line it came from.
  test('counts a carried grace group towards the line it ends up in', () => {
    const graceOn = (step: string, staff: string) =>
      `<note><grace/><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<voice>1</voice><type>eighth</type><staff>${staff}</staff></note>`
    const { part } = read(
      measures(
        GRAND_STAFF +
          note('C', '1') +
          '<backup><duration>4</duration></backup>' +
          graceOn('A', '2') +
          graceOn('B', '2') +
          note('D', '2'),
      ),
    )

    expect(part?.measures[0]?.sequences.map((sequence) => sequence.staff)).toEqual([1, 2])
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

  // A block with no number speaks for every staff, so a numbered block beside
  // it leaves no staff unstated.
  test('says nothing where a key with no number stands beside a numbered one', () => {
    const { warnings } = read(
      measures(
        GRAND_STAFF + note('C', '1'),
        '<attributes><key><fifths>3</fifths></key>' +
          '<key number="1"><fifths>3</fifths></key></attributes>' +
          note('D', '1'),
      ),
    )

    expect(warnings).toEqual([])
  })

  // Stated for the first staff rather than the second, so the staff left out
  // is the last one the loop reaches. The pair says the loop covers every
  // staff, not just the ones before the last.
  test('reports a key stated for the first staff and not the second', () => {
    const { warnings } = read(
      measures(
        GRAND_STAFF + note('C', '1'),
        '<attributes><key number="1"><fifths>3</fifths></key></attributes>' + note('D', '1'),
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

  // The counts agree and the units do not, so the pair says the comparison
  // reads both halves of a time signature, not the count alone.
  test('reports staves that agree on the count and not on the unit', () => {
    const { warnings } = read(
      measures(
        '<attributes><divisions>4</divisions><staves>2</staves>' +
          '<time number="1"><beats>4</beats><beat-type>4</beat-type></time>' +
          '<time number="2"><beats>4</beats><beat-type>8</beat-type></time></attributes>' +
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

// Sibelius leaves <voice> off a chord member, and the member belongs to the
// voice of the event it joins. Read as the unnamed voice, the member has no
// chord to weigh itself against: it states a staff of its own where it shares
// the event's, and a roll on it has no chord to roll.
describe('a chord member that states no voice', () => {
  const member = (step: string, staff: string, extra = '') =>
    `<note><chord/><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
    `<type>quarter</type><staff>${staff}</staff>${extra}</note>`

  test('says nothing of its staff where it shares the one the chord is on', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1', '1') + member('E', '1')))
    const event = part?.measures[0]?.sequences[0]?.content[0]

    expect(event?.kind === 'event' && event.notes.map((n) => n.staff)).toEqual([
      undefined,
      undefined,
    ])
  })

  test('states its own staff where it reaches across to the other hand', () => {
    const { part } = read(measures(GRAND_STAFF + note('C', '1', '1') + member('E', '2')))
    const event = part?.measures[0]?.sequences[0]?.content[0]

    expect(event?.kind === 'event' && event.notes.map((n) => n.staff)).toEqual([undefined, 2])
  })

  // The same for a grace chord: the member joins the grace note before it,
  // which is the event the voice last added.
  test('joins the grace chord before it', () => {
    const grace = (step: string, chord: boolean, voice: string) =>
      `<note>${chord ? '<chord/>' : ''}<grace/>` +
      `<pitch><step>${step}</step><octave>5</octave></pitch><type>eighth</type>` +
      `${voice ? `<voice>${voice}</voice>` : ''}<staff>1</staff></note>`
    const { part, warnings } = read(
      measures(GRAND_STAFF + grace('B', false, '1') + grace('D', true, '') + note('C', '1', '1')),
    )
    const group = part?.measures[0]?.sequences[0]?.content[0]

    expect(group?.kind === 'grace' && group.content[0]?.notes).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  test('rolls the chord it joins', () => {
    const { part, warnings } = read(
      measures(
        GRAND_STAFF +
          note('C', '1', '1') +
          member('E', '1', '<notations><arpeggiate/></notations>'),
      ),
    )

    expect(part?.measures[0]?.arpeggios).toHaveLength(1)
    expect(warnings).toEqual([])
  })
})

describe('how many lines a staff is drawn with', () => {
  const details = (lines: string, number = '') =>
    `<staff-details${number ? ` number="${number}"` : ''}>` +
    `<staff-lines>${lines}</staff-lines></staff-details>`
  const oneStaff = (body: string) =>
    `<attributes><divisions>4</divisions>${body}</attributes>` + note('C', '1')
  // <staff-details> follows the clefs inside <attributes>, as MusicXML orders
  // them.
  const grandStaff = (body: string) => GRAND_STAFF.replace('</attributes>', `${body}</attributes>`)

  test('carries a count other than five as the measure config', () => {
    const { part, warnings } = read(measures(oneStaff(details('1'))))

    expect(part?.measures[0]?.staffConfigs).toEqual([
      { lines: 1, staff: undefined, position: { num: 0, den: 1 } },
    ])
    expect(warnings).toEqual([])
  })

  // Nothing names a staff MNX already draws with five lines, so the count is
  // carried by writing no config at all.
  test.each(['5', '05'])('writes no config for a staff of %s lines', (written) => {
    const { part } = read(measures(oneStaff(details(written))))

    expect(part?.measures[0]?.staffConfigs).toEqual([])
  })

  test('draws a staff on no lines where the source says so', () => {
    const { part } = read(measures(oneStaff(details('0'))))

    expect(part?.measures[0]?.staffConfigs[0]?.lines).toBe(0)
  })

  // A config holds until another replaces it, so restating the count a staff
  // already has says nothing new.
  test('states the count once where later measures restate it', () => {
    const { part } = read(measures(oneStaff(details('1')), oneStaff(details('1'))))

    expect(part?.measures.map((m) => m.staffConfigs.length)).toEqual([1, 0])
  })

  test('states five again where a staff goes back to it', () => {
    const { part } = read(measures(oneStaff(details('1')), oneStaff(details('5'))))

    expect(part?.measures[1]?.staffConfigs[0]?.lines).toBe(5)
  })

  test('names the staff a count is about where the part has more than one', () => {
    const { part } = read(measures(grandStaff(details('1', '2')) + note('C', '1')))

    expect(part?.measures[0]?.staffConfigs).toEqual([
      { lines: 1, staff: 2, position: { num: 0, den: 1 } },
    ])
  })

  // Each staff keeps its own count, so the second changing says nothing about
  // the first.
  test('holds a count per staff', () => {
    const { part } = read(
      measures(grandStaff(details('1', '1') + details('1', '2')) + note('C', '1')),
    )

    expect(part?.measures[0]?.staffConfigs.map((config) => config.staff)).toEqual([1, 2])
  })

  // <attributes> may come partway through a measure, and the config takes
  // effect where the cursor has reached.
  test('states where in the measure the count changes', () => {
    const { part } = read(
      measures(
        '<attributes><divisions>4</divisions></attributes>' +
          note('C', '1') +
          `<attributes>${details('1')}</attributes>` +
          note('D', '1'),
      ),
    )

    expect(part?.measures[0]?.staffConfigs[0]?.position).toEqual({ num: 1, den: 4 })
  })

  test('keeps only the last of two counts stated at the same point', () => {
    const { part, warnings } = read(measures(oneStaff(details('1') + details('3'))))

    expect(part?.measures[0]?.staffConfigs.map((config) => config.lines)).toEqual([3])
    expect(warnings.map((warning) => warning.code)).toEqual(['unrepresentable:staff-config'])
  })

  // MusicXML states the count as a non-negative number, so only a negative
  // one is no count at all. A staff drawn on more lines than any this
  // converter expects is still a staff.
  test('draws a staff on however many lines the source states', () => {
    const { part } = read(measures(oneStaff(details('99'))))

    expect(part?.measures[0]?.staffConfigs[0]?.lines).toBe(99)
  })

  test('refuses a line count that is not a count', () => {
    expect(() => read(measures(oneStaff(details('-1'))))).toThrow(/outside the range/)
  })

  test('writes the config into legal MNX', () => {
    const { mnx, warnings } = convertMusicXML(measures(oneStaff(details('1'))))

    expect(mnx.parts[0]?.measures[0]?.staffConfigs).toEqual([{ config: { lines: 1 } }])
    expect(schemaErrors(mnx)).toEqual([])
    expect(warnings).toEqual([])
  })

  test('writes the staff and the position of a config that states them', () => {
    const { mnx } = convertMusicXML(
      measures(GRAND_STAFF + note('C', '1') + `<attributes>${details('1', '2')}</attributes>`),
    )

    expect(mnx.parts[0]?.measures[0]?.staffConfigs).toEqual([
      { config: { lines: 1 }, position: { fraction: [1, 4] }, staff: 2 },
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
