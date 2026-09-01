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

  // Every size is read in both directions, because the reader states the
  // value for each pairing rather than negating one of them.
  test.each([
    ['down', '8', 1],
    ['down', '15', 2],
    ['down', '22', 3],
    ['up', '8', -1],
    ['up', '15', -2],
    ['up', '22', -3],
  ])('reads a shift "%s" of size %s as %i octaves', (type, size, octaves) => {
    const { ottavas } = read(shift(type, size) + NOTE + shift('stop'))

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

  // A stop with no start before it, then a start nothing stops, both in one
  // part. Joining them by number alone would span backwards, ending before it
  // begins: valid against the schema but refused downstream. Each end is
  // instead reported on its own, and no shift is written.
  test('does not join a stop to a start that comes after it', () => {
    const { ottavas, warnings } = read(shift('stop') + NOTE + shift('down') + NOTE)

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift', 'octave-shift'])
    expect(warnings.map((w) => w.message).sort()).toEqual([
      'An octave shift starts where nothing ends it, and MNX states where one ' +
        'stops, so it is not carried over.',
      'An octave shift stops where none had started, and is not carried over.',
    ])
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

  // The event a shift covers can be written after the stop, past a backup: the
  // stop closes the upper voice's line, and the shift's own note is written
  // below it. Which event the stop covers is settled once the measure is whole,
  // so a note written later still counts.
  test('covers an event written after the stop', () => {
    const voiceOne =
      '<note><voice>1</voice><pitch><step>G</step><octave>2</octave></pitch>' +
      '<duration>8</duration><type>half</type></note>'
    const voiceTwo = (duration: number, rest: boolean) =>
      `<note><voice>2</voice>${rest ? '<rest/>' : '<pitch><step>D</step><octave>1</octave></pitch>'}` +
      `<duration>${String(duration)}</duration><type>quarter</type></note>`
    const { ottavas, warnings } = read(
      voiceOne +
        shift('stop') +
        '<backup><duration>8</duration></backup>' +
        voiceTwo(4, true) +
        shift('down') +
        voiceTwo(4, false),
    )

    expect(ottavas[0]).toEqual([
      {
        // The shift covers one event, the quarter a quarter into the measure,
        // so it begins and ends there.
        position: { num: 1, den: 4 },
        end: { measure: 0, position: { num: 1, den: 4 } },
        value: 1,
        staff: undefined,
      },
    ])
    expect(warnings).toEqual([])
  })

  // An <offset> moves where a mark is drawn, not which events it covers. It
  // is routinely negative, pulling a stop written after a note back on to it,
  // and the shift still ends on that note.
  test.each([
    ['-4', 'pulled back on to the note it ends on'],
    ['4', 'pushed past the note it ends on'],
  ])('covers the same events with a stop %s divisions away, %s', (offset) => {
    const { ottavas, warnings } = read(
      shift('down') + NOTE + NOTE + shift('stop', '8', `<offset>${offset}</offset>`),
    )

    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  // A shift belongs to one staff, so it ends on an event of that staff. The
  // other hand is written after it through a backup, and its notes lie under
  // the same beats without being what the shift covers.
  test('ends on its own staff, not on the other hand written after it', () => {
    const onStaff = (staff: number, step: string, duration: number, type: string) =>
      `<note><voice>${String(staff)}</voice>` +
      `<pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(duration)}</duration><type>${type}</type>` +
      `<staff>${String(staff)}</staff></note>`
    const { ottavas, warnings } = read(
      '<attributes><divisions>4</divisions><staves>2</staves></attributes>' +
        shift('down', '8', '<staff>1</staff>') +
        onStaff(1, 'C', 4, 'quarter') +
        onStaff(1, 'D', 4, 'quarter') +
        shift('stop', '8', '<staff>1</staff>') +
        '<backup><duration>8</duration></backup>' +
        onStaff(2, 'E', 2, 'eighth') +
        onStaff(2, 'F', 2, 'eighth') +
        onStaff(2, 'G', 2, 'eighth') +
        onStaff(2, 'A', 2, 'eighth'),
    )

    // The staff 1 quarter a quarter in, not the staff 2 eighth at three
    // eighths, which is nearer the stop but on the other hand.
    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  // Both hands hold a shift numbered 1 at once, which is what an exporter
  // that numbers each hand from 1 writes. On the number alone each closes on
  // the other hand's stop, and both get the wrong extent.
  test('pairs a shift with the stop on its own staff', () => {
    const hands =
      '<note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>16</duration><type>whole</type><staff>1</staff></note>' +
      '<backup><duration>16</duration></backup>' +
      '<note><voice>2</voice><pitch><step>C</step><octave>3</octave></pitch>' +
      '<duration>16</duration><type>whole</type><staff>2</staff></note>'
    const { ottavas, warnings } = read(
      '<attributes><staves>2</staves></attributes>' +
        shift('down', '8', '<staff>1</staff>') +
        hands,
      shift('up', '8', '<staff>2</staff>') + hands,
      hands + shift('stop', '8', '<staff>1</staff>'),
      hands + shift('stop', '8', '<staff>2</staff>'),
    )

    expect(ottavas[0]?.[0]).toMatchObject({ value: 1, staff: 1, end: { measure: 2 } })
    expect(ottavas[1]?.[0]).toMatchObject({ value: -1, staff: 2, end: { measure: 3 } })
    expect(warnings).toEqual([])
  })

  // A note that names no staff is on the first one, so a shift stopping on
  // staff 1 ends on it.
  test('ends on a note that names no staff, which is the first staff', () => {
    const bare = (step: string) =>
      `<note><voice>1</voice><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>4</duration><type>quarter</type></note>`
    const { ottavas, warnings } = read(
      '<attributes><divisions>4</divisions><staves>2</staves></attributes>' +
        shift('down', '8', '<staff>1</staff>') +
        bare('C') +
        bare('D') +
        shift('stop', '8', '<staff>1</staff>') +
        '<backup><duration>8</duration></backup>' +
        `<note><voice>2</voice><pitch><step>E</step><octave>3</octave></pitch>` +
        `<duration>8</duration><type>half</type><staff>2</staff></note>`,
    )

    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  // Where the stop does not say which staff it is on, MusicXML means the
  // first, but a source that states the staff on the start and leaves it off
  // the stop means the start's. Neither reading is safe to assume, so the
  // last event before the stop stands, whatever staff it sits on.
  test('reads a stop that names no staff against every staff', () => {
    const onStaff = (staff: number, step: string) =>
      `<note><voice>${String(staff)}</voice>` +
      `<pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>2</duration><type>eighth</type><staff>${String(staff)}</staff></note>`
    const { ottavas } = read(
      '<attributes><divisions>4</divisions><staves>2</staves></attributes>' +
        shift('down', '8', '<staff>1</staff>') +
        `<note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch>` +
        `<duration>4</duration><type>quarter</type><staff>1</staff></note>` +
        shift('stop') +
        '<backup><duration>4</duration></backup>' +
        onStaff(2, 'E') +
        onStaff(2, 'F'),
    )

    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 8 } })
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

  // The stop's cursor can sit past the start while the last event it covers
  // falls before it: one event early in the measure, then a gap the start and
  // stop both fall in with nothing between them. The end would then precede the
  // start, which no consumer accepts, so the shift is dropped and reported.
  test('drops a shift whose stop covers an event before the start', () => {
    const forward = (by: number) => `<forward><duration>${String(by)}</duration></forward>`
    // Only event is the quarter at 0. Start at 3/4, stop at 7/8: the last event
    // before the stop is that quarter at 0, so the end would be 0, before 3/4.
    const { ottavas, warnings } = read(
      NOTE + forward(8) + shift('down') + forward(2) + shift('stop'),
    )

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
    expect(warnings[0]?.message).toContain('end before it starts')
  })

  test('reports a size MNX has no value for', () => {
    const { ottavas, warnings } = read(shift('down', '9') + NOTE)

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
  })

  // The source did start the shift; the reader dropped it. Its stop is not an
  // orphan, so one warning per lost shift, at the start that was dropped.
  test('warns once for a dropped shift, not again at its stop', () => {
    const { ottavas, warnings } = read(shift('down', '9') + NOTE + shift('stop'))

    expect(ottavas[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['octave-shift'])
    expect(warnings[0]?.message).toContain('not carried over')
  })

  // A dropped start consumes its own stop, the way pairing works everywhere
  // here: a stop closes the most recently opened start of its number. The
  // healthy shift around it keeps its own stop.
  test('a dropped shift consumes its own stop, leaving a healthy one intact', () => {
    const { ottavas, warnings } = read(
      shift('down') + NOTE + shift('down', '9') + NOTE + shift('stop') + NOTE + shift('stop'),
    )

    expect(ottavas[0]).toEqual([
      {
        position: { num: 0, den: 1 },
        end: { measure: 0, position: { num: 1, den: 2 } },
        value: 1,
        staff: undefined,
      },
    ])
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

// Grace notes take none of the measure's time, so they share the place of the
// note they ornament. MNX reads a place with no grace index as before all of
// them, and counts back from the ornamented note: that note is 0 and the
// rightmost grace note is 1. A shift ending on a note whose grace notes it
// covers must say 0, or they fall outside it.
describe('an octave shift ending where grace notes sit', () => {
  const GRACE =
    '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>'

  test('ends on the ornamented note, taking in the grace notes before it', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE + GRACE + NOTE + shift('stop'))

    expect(ottavas[0]?.[0]?.end).toEqual({
      measure: 0,
      position: { num: 1, den: 4 },
      graceIndex: 0,
    })
    expect(warnings).toEqual([])
  })

  // Nothing follows the grace notes, so the last event the shift covers is
  // the rightmost of them rather than a note they ornament.
  test('ends on the last grace note where no note follows it', () => {
    const { ottavas, warnings } = read(
      shift('down') + NOTE + GRACE + '<forward><duration>4</duration></forward>' + shift('stop'),
    )

    expect(ottavas[0]?.[0]?.end).toEqual({
      measure: 0,
      position: { num: 1, den: 4 },
      graceIndex: 1,
    })
    expect(warnings).toEqual([])
  })

  // The stop falls between the grace notes and the note they ornament, so the
  // bracket is drawn over the grace notes and stops before that note.
  test('ends on the grace notes its stop is written after', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE + GRACE + shift('stop') + NOTE)

    expect(ottavas[0]?.[0]?.end).toEqual({
      measure: 0,
      position: { num: 1, den: 4 },
      graceIndex: 1,
    })
    expect(warnings).toEqual([])
  })

  // Two grace notes with the stop between them: the bracket covers the first
  // and stops before the second, which counting back from the note they
  // ornament makes 2.
  test('ends on the grace note its stop is written after, not the last of the group', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE + GRACE + shift('stop') + GRACE + NOTE)

    expect(ottavas[0]?.[0]?.end).toEqual({
      measure: 0,
      position: { num: 1, den: 4 },
      graceIndex: 2,
    })
    expect(warnings).toEqual([])
  })

  // The stop is written before the grace notes, so they stand outside the
  // bracket and the shift ends on the note before them.
  test('says nothing where the stop is written before the grace notes', () => {
    const { ottavas, warnings } = read(shift('down') + NOTE + shift('stop') + GRACE + NOTE)

    expect(ottavas[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 0, den: 1 } })
    expect(warnings).toEqual([])
  })

  test('writes the grace index onto schema-valid MNX', () => {
    const { mnx, warnings } = convertMusicXML(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        shift('down') +
        NOTE +
        GRACE +
        NOTE +
        shift('stop') +
        '</measure></part></score-partwise>',
    )

    expect(mnx.parts[0]?.measures[0]?.ottavas?.[0]?.end).toEqual({
      measure: 'm1',
      position: { fraction: [1, 4], graceIndex: 0 },
    })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })
})
