// A note inside a tuplet lasts its written value scaled by the ratios around
// it. These tests cover notes whose <type>, <duration> or <time-modification>
// does not agree with that, or is missing.

import { describe, expect, test } from 'vitest'
import { measure, measures, tremoloNote, TRIPLET, tupletNote } from '../../tests/support/tuplets.js'
import { notesOf, readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

// A note inside a tuplet is compared with its written value scaled by the
// ratio around it, and the report names that scaled length.
describe('a note inside a tuplet lasting the wrong time', () => {
  test('names the length the ratio wants, not the written one twice', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 6, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const reported = warnings.filter((w) => w.code === 'inconsistent:duration')

    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toBe(
      'A <note> is written as an eighth, which the tuplet around it makes 1/12 of a ' +
        'whole note, but it lasts an eighth. The written value is the one converted.',
    )
  })

  // Each note of a two-note tremolo is written with the value of the pair and
  // lasts half of it, so a tremolo scales a written value as a tuplet does.
  test('names the tremolo where a tremolo is what scales the note', () => {
    // Each note is written as a half, so the pair wants a quarter each; both
    // last a dotted quarter instead, which is the source disagreeing with
    // itself while the tremolo is what scales them.
    const long = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>18</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
    const { warnings } = read(measure(long('C', 'start') + long('E', 'stop')))
    const reported = warnings.filter((w) => w.code === 'inconsistent:duration')

    expect(reported[0]?.message).toContain('which the tremolo around it makes')
  })

  // Outside a tuplet nothing scales the written value, and the report says
  // the two lengths plainly.
  test('says the written value and the length plainly outside a tuplet', () => {
    const { warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
          '<type>eighth</type></note>',
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
    expect(warnings[0]?.message).toBe(
      'A <note> is written as an eighth but lasts a quarter. The written value is the one converted.',
    )
  })
})

describe('a note inside a bracket stating a ratio of its own', () => {
  const rated = (step: string, actual: number, normal: number, markers = '', units = 4) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification>` +
    (markers ? `<notations>${markers}</notations>` : '') +
    '</note>'

  test('reports a ratio that disagrees with the bracket, and keeps the bracket', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          rated('D', 5, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['inconsistent:tuplet', 'time-modification'],
    ])
    expect(warnings[0]?.message).toBe(
      "A note's <time-modification> gives it 4/5 of its written value. Inside the tuplet " +
        'around it, it lasts 2/3. The tuplet is the one converted.',
    )
    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      3, 2,
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
  })

  test('reports a ratio that gives the note less time than the bracket', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          rated('D', 9, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      "A note's <time-modification> gives it 4/9 of its written value. Inside the tuplet " +
        'around it, it lasts 2/3. The tuplet is the one converted.',
    ])
  })

  // Six in the time of four plays each note as three in the time of two does.
  test('passes over a ratio that counts differently but gives the same time', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          rated('D', 6, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  // A <time-modification> states every level around the note multiplied.
  test('compares the ratio with every bracket around the note', () => {
    // At 18 divisions an eighth lasts 9: 6 at three in the time of two, and 4
    // at that inside another three in the time of two.
    const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'
    const nested = (actual: number, normal: number) =>
      read(
        measures(
          '<attributes><divisions>18</divisions></attributes>' +
            rated('C', 3, 2, '<tuplet type="start" number="1"/>', 6) +
            rated('D', 9, 4, '<tuplet type="start" number="2"/>') +
            rated('E', actual, normal) +
            rated('F', 9, 4, stops),
        ),
      ).warnings

    expect(nested(9, 4)).toEqual([])
    expect(nested(3, 2).map((w) => [w.code, w.element])).toEqual([
      ['inconsistent:tuplet', 'time-modification'],
    ])
  })

  // Each note of a two-note tremolo states the pair's 2:1 multiplied into the
  // tuplet around it: six in the time of two inside a triplet.
  test('counts a two-note tremolo with the bracket around it', () => {
    const pair = (actual: number) => {
      const note = (step: string, type: string, stop = '') =>
        `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
        '<duration>4</duration><type>quarter</type>' +
        `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
        '<normal-notes>2</normal-notes></time-modification>' +
        `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments>${stop}` +
        '</notations></note>'
      // The pair is written as two quarters and lasts one triplet quarter, so
      // the bracket holds three eighths.
      return read(
        measure(
          tupletNote('C', 4, 'eighth', 'start') +
            note('D', 'start') +
            note('E', 'stop', '<tuplet type="stop"/>'),
        ),
      ).warnings
    }

    const reported =
      "A note's <time-modification> gives it 2/3 of its written value. Inside the tuplet " +
      'and two-note tremolo around it, it lasts 1/3. The tuplet and two-note tremolo is ' +
      'the one converted.'

    expect(pair(6)).toEqual([])
    expect(pair(3).map((w) => w.message)).toEqual([reported, reported])
  })

  test('compares the ratio with a two-note tremolo where no bracket is open', () => {
    const { warnings } = read(
      measure(
        tremoloNote('C', 'start') +
          tremoloNote('E', 'stop').replace('<actual-notes>2', '<actual-notes>3'),
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      "A note's <time-modification> gives it 1/3 of its written value. Inside the two-note " +
        'tremolo around it, it lasts 1/2. The two-note tremolo is the one converted.',
    ])
  })

  // Two brackets open on C and neither marker says how its 9:4 divides
  // between them, so the converter gives it all to the outer one. F states the
  // outer bracket's share, which is the source's division, not a disagreement.
  test('passes over a bracket whose ratio the converter divided out', () => {
    const starts = '<tuplet type="start" number="1"/><tuplet type="start" number="2"/>'
    const { warnings } = read(
      measures(
        '<attributes><divisions>18</divisions></attributes>' +
          rated('C', 9, 4, starts) +
          rated('D', 9, 4) +
          rated('E', 9, 4, '<tuplet type="stop" number="2"/>') +
          rated('F', 3, 2, '<tuplet type="stop" number="1"/>', 6),
      ),
    )

    expect(warnings.filter((w) => w.element === 'time-modification')).toEqual([])
  })

  // A grace note takes none of the measure's time, so its ratio scales nothing.
  test('passes over the ratio of a grace note', () => {
    const grace =
      '<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>16th</type>' +
      '<time-modification><actual-notes>1</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification></note>'
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          grace +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  test('refuses a ratio that plays no notes', () => {
    const error = readFailure(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          rated('D', 0, 2) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(error.message).toContain('<actual-notes> is 0, outside the range 1 to 1000.')
  })
})

describe('a chord member stating a ratio of its own', () => {
  const member = (actual: number, normal: number) =>
    '<note><chord/><pitch><step>G</step><octave>4</octave></pitch>' +
    '<duration>4</duration><type>eighth</type>' +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    `<normal-notes>${String(normal)}</normal-notes></time-modification></note>`
  const plain = (step: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>4</duration><type>eighth</type></note>'

  test('reports a ratio that disagrees with the note it joins, and keeps the chord', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          member(5, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'inconsistent:tuplet',
        'time-modification',
        "A chord note's <time-modification> gives it 4/5 of its written value. The note it " +
          'joins lasts 2/3. The note it joins is the one converted.',
      ],
    ])
    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      3, 2,
    ])
    const events = tuplet?.kind === 'tuplet' ? tuplet.content : []
    expect(events.map((event) => event.kind === 'event' && notesOf(event).length)).toEqual([
      1, 2, 1,
    ])
  })

  // Six in the time of four plays each note as three in the time of two does.
  test('passes over a ratio that counts differently but gives the same time', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          member(6, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  test('compares the ratio with a note that closes the bracket', () => {
    const { warnings } = read(measure(TRIPLET + member(5, 4)))

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['inconsistent:tuplet', 'time-modification'],
    ])
  })

  // The bracket overrules the ratio D states, so the chord lasts what the
  // member states, and only D is reported.
  test('compares the ratio with what the note it joins lasts, not what it states', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth').replace('<actual-notes>3', '<actual-notes>5') +
          member(3, 2) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      "A note's <time-modification> gives it 2/5 of its written value. Inside the tuplet " +
        'around it, it lasts 2/3. The tuplet is the one converted.',
    ])
  })

  test('compares the ratio with the bracket where the note it joins states none', () => {
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          plain('D') +
          member(5, 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings.map((w) => w.message)).toEqual([
      "A chord note's <time-modification> gives it 4/5 of its written value. The note it " +
        'joins lasts 2/3. The note it joins is the one converted.',
    ])
  })

  test('reports a ratio on a chord no tuplet scales', () => {
    const eighth = (note: string) => note.replace('<duration>4', '<duration>6')
    const { warnings } = read(measure(eighth(plain('C')) + eighth(member(3, 2))))

    expect(warnings.map((w) => w.message)).toEqual([
      "A chord note's <time-modification> gives it 2/3 of its written value. The note it " +
        'joins lasts 1/1. The note it joins is the one converted.',
    ])
  })

  test('compares the ratio with the note of a two-note tremolo it joins', () => {
    const chord = (actual: number) =>
      tremoloNote('G', 'start')
        .replace('<note>', '<note><chord/>')
        .replace('<actual-notes>2', `<actual-notes>${String(actual)}`)
    const tremolo = (actual: number) =>
      read(measure(tremoloNote('C', 'start') + chord(actual) + tremoloNote('E', 'stop'))).warnings

    expect(tremolo(2)).toEqual([])
    expect(tremolo(4).map((w) => w.message)).toEqual([
      "A chord note's <time-modification> gives it 1/4 of its written value. The note it " +
        'joins lasts 1/2. The note it joins is the one converted.',
    ])
  })

  // A grace note takes none of the measure's time, so its ratio is not read.
  test('passes over the ratio of a grace chord', () => {
    const grace = (step: string, actual: number, extra = '') =>
      `<note>${extra}<grace/><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<type>eighth</type><time-modification>' +
      `<actual-notes>${String(actual)}</actual-notes><normal-notes>2</normal-notes>` +
      '</time-modification></note>'
    const chord = (head: number, joining: number) =>
      read(
        measure(
          tupletNote('C', 4, 'eighth', 'start') +
            grace('D', head) +
            grace('F', joining, '<chord/>') +
            tupletNote('D', 4, 'eighth') +
            tupletNote('E', 4, 'eighth', 'stop'),
        ),
      ).warnings

    expect(chord(3, 5)).toEqual([])
    expect(chord(0, 3)).toEqual([])
  })

  test('refuses a ratio that plays no notes', () => {
    const error = readFailure(measure(TRIPLET + member(0, 2)))

    expect(error.message).toContain('<actual-notes> is 0, outside the range 1 to 1000.')
  })
})

// A <note> stating no <type> is measured from its <duration>, which is the
// time it sounds. Inside a tuplet or a tremolo that time is the written value
// scaled by the ratio, so the duration is divided by the ratio before the
// value is read.
describe('a note inside a tuplet stating no <type>', () => {
  const typeless = (step: string, units: number) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification></note>'

  test('reads the value the ratio counts, not the time it sounds', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          typeless('D', 4) +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside[1]?.kind === 'event' && inside[1].value).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings).toEqual([])
  })

  // Each note of a two-note tremolo is written with the pair's value and
  // lasts half of it, so the pair scales a written value as a tuplet does.
  test('reads the value the pair of a tremolo counts', () => {
    const typelessTremolo = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>12</duration>` +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + typelessTremolo('E', 'stop')),
    )
    const item = content?.[0]
    const inside = item?.kind === 'multiNoteTremolo' ? item.content : []

    expect(inside[1]?.value).toEqual({ base: 'half', dots: 0 })
    expect(warnings).toEqual([])
  })

  // The pair is what scales the note, and the refusal says so.
  test('names the tremolo where a tremolo is what scales the note', () => {
    const odd =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>5</duration>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'
    let thrown = ''
    try {
      read(measure(tremoloNote('C', 'start') + odd))
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toContain('by the tremolo around it')
  })

  test('refuses a time no note value can write, naming what it is written as', () => {
    let thrown = ''
    try {
      read(
        measure(
          tupletNote('C', 4, 'eighth', 'start') +
            typeless('D', 5) +
            tupletNote('E', 4, 'eighth', 'stop'),
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>. It lasts 5/48 of a whole note, written as 5/32 of a ' +
        'whole note by the tuplet around it, which no note value can write.',
    )
  })

  // Some exporters write a <duration> on a grace note even though it takes
  // no time. No ratio scaled that duration, so it is not divided by one.
  test('reads a grace note’s own duration inside a bracket unscaled', () => {
    const graceInside =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          graceInside +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []
    const group = inside[1]

    expect(group?.kind === 'grace' && group.content[0]?.value).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings).toEqual([])
  })

  // The same duration is compared with the written value here as the value
  // is read from there: unscaled, because the ratio scales nothing a grace
  // note carries.
  test('weighs a grace note’s own duration against its value unscaled', () => {
    const graceInside =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          graceInside +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(warnings).toEqual([])
  })

  // A bracket may state a ratio that scales nothing. The refusal then reads
  // as it does outside a bracket, rather than naming one length twice.
  test('names the length once where the ratio scales nothing', () => {
    const oneToOne = (units: number, bracket = '') =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${String(units)}</duration>` +
      '<time-modification><actual-notes>1</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    let thrown = ''
    try {
      read(
        measure(
          `<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>` +
            '<type>quarter</type><time-modification><actual-notes>1</actual-notes>' +
            '<normal-notes>1</normal-notes></time-modification>' +
            '<notations><tuplet type="start"/></notations></note>' +
            oneToOne(5),
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>, and lasts 5/48 of a whole note, which no note value can write.',
    )
  })

  test('names the length plainly where nothing scales it', () => {
    let thrown = ''
    try {
      read(
        measure(
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof MusicXMLError ? error.detail : String(error)
    }

    expect(thrown).toBe(
      'A <note> states no <type>, and lasts 5/48 of a whole note, which no note value can write.',
    )
  })

  test('converts to MNX the schema accepts', () => {
    const source = measure(
      tupletNote('C', 4, 'eighth', 'start') +
        typeless('D', 4) +
        tupletNote('E', 4, 'eighth', 'stop'),
    )
    convertValid(source)
  })
})

// A <time-modification> with no <normal-type> counts the note's own <type>.
// On a note stating none it counts nothing, so it says nothing about how long
// a group is, and the note lasts its <duration>.
describe('a ratio on a note stating no <type>, with no bracket', () => {
  const RATIO =
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>'

  test('converts a rest that fills the measure as the measure rest', () => {
    const source = measures(
      '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type>' +
        '</time></attributes>' +
        `<note><rest measure="yes"/><duration>48</duration>${RATIO}</note>`,
    )
    const warnings = new WarningCollector()
    const sequence = readValid(source, warnings).parts[0]?.measures[0]?.sequences[0]

    expect(sequence?.content).toEqual([])
    expect(sequence?.fullMeasure).toBeDefined()
    expect(warnings.list().map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'missing:normal-type',
        'time-modification',
        'A <time-modification> counts no note value: it states no <normal-type>, and the ' +
          'note states no <type>. The ratio is not converted, and the note is read ' +
          'without it.',
      ],
    ])
  })

  test('converts a note by the time it lasts', () => {
    const { content, warnings } = read(
      measure(
        `<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>${RATIO}` +
          '</note>',
      ),
    )

    expect(content?.map((item) => item.kind === 'event' && item.value)).toEqual([
      { base: 'quarter', dots: 0 },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['missing:normal-type'])
  })

  test('rejects counts that are not whole numbers', () => {
    const broken = RATIO.replace('<actual-notes>3</actual-notes>', '<actual-notes>x</actual-notes>')

    expect(() =>
      read(measure(`<note><rest measure="yes"/><duration>48</duration>${broken}</note>`)),
    ).toThrow(MusicXMLError)
  })

  // Inside a run the ratio is what says where the run ends, so a note whose
  // ratio counts nothing cannot be placed in it or after it.
  test('rejects a note inside a run of ratios', () => {
    const typeless =
      `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>${RATIO}` +
      '</note>'
    const eighth =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      `<type>eighth</type>${RATIO}</note>`

    expect(readFailure(measure(eighth + typeless)).message).toContain(
      'A tuplet states no note value to count.',
    )
  })

  // A full run is over, so a ratio after it says nothing about where it ends.
  test('passes over the ratio of a rest after a run that is full', () => {
    const eighth = (step: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>eighth</type>${RATIO}</note>`
    const { content, warnings } = read(
      measure(
        eighth('C') +
          eighth('D') +
          eighth('E') +
          `<note><rest/><duration>12</duration>${RATIO}</note>`,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['missing:normal-type'])
  })

  test('drops a rest written over the measure rest', () => {
    const warnings = new WarningCollector()
    readValid(
      measure(
        '<note><rest measure="yes"/><duration>48</duration></note>' +
          '<backup><duration>48</duration></backup>' +
          `<note><rest/><duration>12</duration>${RATIO}</note>`,
      ),
      warnings,
    )

    expect(warnings.list().map((w) => w.code)).toEqual(['redundant:rest'])
  })
})

// A <note> stating no <duration> lasts its written value as the tuplets and
// tremolos around it scale it, as one stating the matching duration does.
describe('a note inside a tuplet stating no <duration>', () => {
  const FOUR_FOUR =
    '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' +
    '</attributes>'
  const unmeasured = (notes: string) => notes.replaceAll(/<duration>\d+<\/duration>/g, '')
  const after =
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
    '<type>quarter</type></note>' +
    '<note><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration>' +
    '<type>quarter</type></note>'

  test.each([
    ['a tuplet', TRIPLET],
    ['a tremolo', tremoloNote('C', 'start') + tremoloNote('E', 'stop')],
  ])('reads the notes inside %s as their stated durations read them', (_, group) => {
    const measured = read(measures(FOUR_FOUR + group + after))
    const unstated = read(measures(FOUR_FOUR + unmeasured(group) + after))

    expect(unstated.content).toEqual(measured.content)
    expect(unstated.warnings).toEqual(measured.warnings)
  })
})
