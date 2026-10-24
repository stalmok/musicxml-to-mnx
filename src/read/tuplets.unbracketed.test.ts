// Tuplets that the source states as a ratio on each note, with no bracket.

import { describe, expect, test } from 'vitest'
import {
  bracketedNote,
  DIVISIONS,
  measure,
  measures,
  tupletNote,
} from '../../tests/support/tuplets.js'
import { readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

// MusicXML states a tuplet twice, and the two say different things: the
// ratio on every note is what makes it a tuplet, and the bracket only draws
// one. Exporters write the ratio alone. The ratio fixes the group's length,
// so consecutive notes carrying it divide into one group after another with
// nothing guessed.
describe('a tuplet the source states as a ratio with no bracket', () => {
  /** A note of `units` divisions written as `type`, with a `played`:`space` ratio. */
  const rated = (step: string, units: number, type: string, played = 3, space = 2) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    `<time-modification><actual-notes>${String(played)}</actual-notes>` +
    `<normal-notes>${String(space)}</normal-notes></time-modification></note>`

  /** A note of `units` divisions written as `type`, with no ratio on it. */
  const plain = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type></note>`

  test('gathers three notes carrying the ratio into one tuplet', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + rated('E', 4, 'eighth')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // Six triplet eighths are two triplets, not one group of six: the ratio
  // says three are played in the time of two, and that is where each closes.
  test('cuts a longer run into one group after another', () => {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A'].map((step) => rated(step, 4, 'eighth')).join('')
    const { content, warnings } = read(measure(notes))

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // A group is full at the written length its ratio counts, whatever values
  // fill it: a triplet quarter and a triplet eighth make three eighths. The
  // quarter says so with <normal-type>, which is what the ratio counts.
  const countedInEighths =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>quarter</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '<normal-type>eighth</normal-type></time-modification></note>' +
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '<normal-type>eighth</normal-type></time-modification></note>'

  test('closes a group of mixed values at the length the ratio counts', () => {
    const { content, warnings } = read(measure(countedInEighths + plain('E', 12, 'quarter')))

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(content?.[1]?.kind).toBe('event')
    expect(warnings).toEqual([])
  })

  test('leaves a note carrying no ratio outside the group', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          plain('F', 12, 'quarter'),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind).toBe('event')
    expect(warnings).toEqual([])
  })

  // A run the source cut short holds two eighths sounding a sixth of a whole
  // note, which no pair of note values states, so it counts what it holds and
  // keeps the space its ratio gives it.
  test('closes a group a note carrying no ratio interrupts', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + plain('E', 12, 'quarter')),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
  })

  test('starts a new group where the ratio changes', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          rated('F', 3, 'eighth', 4, 2) +
          rated('G', 3, 'eighth', 4, 2) +
          rated('A', 3, 'eighth', 4, 2) +
          rated('B', 3, 'eighth', 4, 2),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].inner.multiple).toBe(3)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind === 'tuplet' && content[1].inner.multiple).toBe(4)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(4)
    expect(warnings).toEqual([])
  })

  // The ratio alone does not say which tuplet a note belongs to: three in the
  // time of two and three in the time of one are the same three notes played
  // over different spans.
  test('starts a new group where the space the ratio is played in changes', () => {
    const { content } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 2, 'eighth', 3, 1) +
          rated('F', 2, 'eighth', 3, 1) +
          rated('G', 2, 'eighth', 3, 1),
      ),
    )

    expect(content).toHaveLength(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].outer.multiple).toBe(2)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(content?.[1]?.kind === 'tuplet' && content[1].outer.multiple).toBe(1)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(3)
  })

  // A ratio stating no <normal-type> counts the note's own written value, so a
  // run written in several values states no one length. It holds together and
  // says what it holds when it closes, as a bracket stating no ratio does.
  // Sources write this: three rests as a whole, a double-dotted quarter and
  // a 16th, each marked three in the time of two, together three halves.
  test('states a run written in several values by what it holds', () => {
    const doubleDotted =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>14</duration>' +
      '<type>quarter</type><dot/><dot/>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(rated('C', 32, 'whole') + doubleDotted + rated('E', 2, '16th')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'half', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'half', dots: 0 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })

  // A grace note takes none of the measure's time, so it neither fills a run
  // nor ends one.
  test('reaches a run over a grace note written inside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>16th</type></note>'
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + grace + rated('E', 4, 'eighth')),
    )
    const tuplet = content?.[0]

    expect(content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(4)
    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(warnings).toEqual([])
  })

  // A run that holds all its ratio counts is over, so a grace note after it
  // leads to the next note, as it does after a drawn bracket.
  test('leaves a grace note after a full run outside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          grace +
          plain('G', 12, 'quarter'),
      ),
    )
    const tuplet = content?.[0]

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'grace', 'event'])
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  test('leaves a grace note between two full runs outside both', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          grace +
          rated('F', 4, 'eighth') +
          rated('G', 4, 'eighth') +
          rated('A', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'grace', 'tuplet'])
    expect(
      content?.map((item) => (item.kind === 'tuplet' ? item.content.length : undefined)),
    ).toEqual([3, undefined, 3])
    expect(warnings).toEqual([])
  })

  // A bracket the source drew says where its tuplet starts, on a grace note
  // as on any other, so the run before it ends there, short of its ratio.
  describe('a run with room left before a grace note that opens a bracket', () => {
    const opening =
      '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start" bracket="yes"/></notations></note>'
    const bracketed = (step: string, bracket = '') =>
      rated(step, 4, 'eighth').replace(
        '</note>',
        bracket ? `<notations><tuplet type="${bracket}"/></notations></note>` : '</note>',
      )

    test('closes the run before the bracket', () => {
      const { content, warnings } = read(
        measure(
          rated('A', 4, 'eighth') +
            opening +
            bracketed('D') +
            bracketed('E') +
            bracketed('F', 'stop'),
        ),
      )
      const [run, tuplet] = content ?? []

      expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'tuplet'])
      expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual(['event'])
      expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
        3, 2,
      ])
      expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('yes')
      expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
        'grace',
        'event',
        'event',
        'event',
      ])
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
    })

    // The grace note's group holds nothing that takes time, so the bracket
    // states no tuplet, and the run reaches over it.
    test('leaves the run open over a bracket that closes on grace notes alone', () => {
      const closing =
        '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type>' +
        '<notations><tuplet type="stop"/></notations></note>'
      const { content, warnings } = read(
        measure(
          rated('A', 4, 'eighth') +
            rated('B', 4, 'eighth') +
            opening +
            closing +
            rated('C', 4, 'eighth'),
        ),
      )
      const run = content?.[0]

      expect(content).toHaveLength(1)
      expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual([
        'event',
        'event',
        'grace',
        'event',
      ])
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
    })

    // The run stays open over a bracket that closes on grace notes alone. A
    // grace note may state the run's ratio with the bracket's, or leave it
    // out, so a marker disagrees only where it fits neither.
    describe('a bracket over grace notes alone whose marker states its ratio', () => {
      const grace = (step: string, played: number, space: number, bracket: string) =>
        `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch><type>16th</type>` +
        `<time-modification><actual-notes>${String(played)}</actual-notes>` +
        `<normal-notes>${String(space)}</normal-notes></time-modification>` +
        `<notations>${bracket}</notations></note>`
      const stating = (number = '1') =>
        `<tuplet type="start" number="${number}"><tuplet-actual><tuplet-number>3</tuplet-number>` +
        '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number></tuplet-normal></tuplet>'
      const stop = (number = '1') => `<tuplet type="stop" number="${number}"/>`
      const group = (played: number, space: number) =>
        grace('B', played, space, stating()) + grace('D', played, space, stop())

      test.each([
        [9, 4, ['unrepresentable:tuplet-untimed']],
        [3, 2, ['unrepresentable:tuplet-untimed']],
        [5, 4, ['inconsistent:tuplet', 'unrepresentable:tuplet-untimed']],
      ])('checks a %i:%i grace note with and without the run around it', (played, space, codes) => {
        const { warnings } = read(
          measure(
            rated('A', 4, 'eighth') +
              rated('B', 4, 'eighth') +
              group(played, space) +
              rated('C', 4, 'eighth'),
          ),
        )

        expect(warnings.map((w) => w.code)).toEqual(codes)
      })

      // The outer bracket opened inside the run, so its ratio holds the run's
      // share already.
      test('checks a bracket over grace notes alone inside another', () => {
        const { warnings } = read(
          measure(
            rated('A', 4, 'eighth') +
              rated('B', 4, 'eighth') +
              grace('E', 9, 4, stating('1')) +
              grace('F', 27, 8, stating('2')) +
              grace('G', 27, 8, stop('2')) +
              grace('A', 9, 4, stop('1')) +
              rated('C', 4, 'eighth'),
          ),
        )

        expect(warnings.map((w) => w.code)).toEqual([
          'unrepresentable:tuplet-untimed',
          'unrepresentable:tuplet-untimed',
        ])
      })

      // The outer grace note leaves the run's ratio out and the inner one
      // counts it. The group is read into the half's line where E overlaps
      // the half, and goes to the run's line.
      test.each([
        ['where it stays', ''],
        [
          'where its group goes to the run',
          '<backup><duration>8</duration></backup>' +
            plain('A', 24, 'half') +
            '<backup><duration>16</duration></backup>',
        ],
      ])('checks brackets over grace notes alone that count the run apart %s', (_, between) => {
        const { warnings } = read(
          measure(
            rated('A', 4, 'eighth') +
              rated('B', 4, 'eighth') +
              between +
              grace('E', 3, 2, stating('1')) +
              grace('F', 27, 8, stating('2')) +
              grace('G', 27, 8, stop('2')) +
              grace('A', 3, 2, stop('1')) +
              rated('C', 4, 'eighth'),
          ),
        )
        const markers = warnings.filter((w) => w.message.startsWith("A tuplet's start marker"))

        expect(markers).toEqual([])
      })

      // D enters the outer bracket, so the run closes before it, and the
      // inner bracket is inside the outer one alone.
      test('checks a bracket over grace notes alone inside one that goes on to hold notes', () => {
        const outer = '<tuplet type="start" number="1"/>'
        const { warnings } = read(
          measure(
            rated('A', 4, 'eighth') +
              rated('B', 4, 'eighth') +
              grace('G', 3, 2, outer) +
              grace('B', 9, 4, stating('2')) +
              grace('D', 9, 4, stop('2')) +
              rated('D', 4, 'eighth') +
              rated('E', 4, 'eighth') +
              rated('F', 4, 'eighth').replace(
                '</note>',
                `<notations>${stop('1')}</notations></note>`,
              ),
          ),
        )

        const markers = warnings.filter((w) => w.message.startsWith("A tuplet's start marker"))
        expect(markers).toEqual([])
      })

      // The group goes to the run's line with its bracket still open, so the
      // run there closes before it. The marker's 3:2 is the bracket's alone,
      // against the notes' 9:4.
      test('checks a bracket that goes on to hold notes against its own ratio alone', () => {
        const nine = (step: string, bracket = '') =>
          rated(step, 8, 'eighth', 9, 4).replace(
            '</note>',
            bracket ? `<notations>${bracket}</notations></note>` : '</note>',
          )
        const { warnings } = read(
          measures(
            '<attributes><divisions>36</divisions></attributes>' +
              rated('C', 12, 'eighth') +
              rated('D', 12, 'eighth') +
              '<backup><duration>24</duration></backup>' +
              plain('A', 72, 'half') +
              '<backup><duration>48</duration></backup>' +
              grace('B', 9, 4, stating()) +
              nine('E') +
              nine('F') +
              nine('G', stop()),
          ),
        )
        const markers = warnings.filter((w) => w.message.startsWith("A tuplet's start marker"))

        expect(markers).toHaveLength(1)
      })

      // E overlaps the half in the line the group was read into, so the
      // group goes to the run's line.
      test('checks a grace note against the run of the line its group goes to', () => {
        const warnings = new WarningCollector()
        const result = readValid(
          measure(
            rated('C', 4, 'eighth') +
              rated('D', 4, 'eighth') +
              '<backup><duration>8</duration></backup>' +
              plain('A', 24, 'half') +
              '<backup><duration>16</duration></backup>' +
              group(9, 4) +
              rated('E', 4, 'eighth'),
          ),
          warnings,
        )
        const run = result.parts[0]?.measures[0]?.sequences[0]?.content[0]

        expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual([
          'event',
          'event',
          'grace',
          'event',
        ])
        expect(warnings.list().map((w) => w.code)).toEqual([
          'unrepresentable:tuplet-untimed',
          'inconsistent:voice',
        ])
      })
    })

    // D overlaps A, so it takes a new line, and the bracket the grace note
    // opened goes with it. B and C go back to A's line and fill its run.
    test('leaves the run open in the line a bracket leaves', () => {
      const warnings = new WarningCollector()
      const result = readValid(
        measure(
          rated('A', 4, 'eighth') +
            '<backup><duration>4</duration></backup>' +
            opening +
            bracketed('D') +
            bracketed('E') +
            bracketed('F', 'stop') +
            '<backup><duration>8</duration></backup>' +
            rated('B', 4, 'eighth') +
            rated('C', 4, 'eighth'),
        ),
        warnings,
      )
      const [left, taken] = result.parts[0]?.measures[0]?.sequences ?? []
      const run = left?.content[0]
      const tuplet = taken?.content[0]

      expect(left?.content).toHaveLength(1)
      expect(run?.kind === 'tuplet' && run.content).toHaveLength(3)
      expect(taken?.content).toHaveLength(1)
      expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
        3, 2,
      ])
      expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('yes')
      expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
        'grace',
        'event',
        'event',
        'event',
      ])
      expect(warnings.list().map((w) => w.code)).toEqual(['inconsistent:voice'])
    })

    // The note the grace note leads into overlaps the half in the line the
    // grace note was read into, so the group goes back to the run's line.
    test('closes the run in the line the bracket goes to', () => {
      const warnings = new WarningCollector()
      const result = readValid(
        measure(
          rated('A', 4, 'eighth') +
            '<backup><duration>4</duration></backup>' +
            plain('C', 24, 'half') +
            '<backup><duration>20</duration></backup>' +
            opening +
            bracketed('D') +
            bracketed('E') +
            bracketed('F', 'stop'),
        ),
        warnings,
      )
      const [run, tuplet] = result.parts[0]?.measures[0]?.sequences[0]?.content ?? []

      expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual(['event'])
      expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
        3, 2,
      ])
      expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(4)
      expect(warnings.list().map((w) => w.code)).toEqual([
        'unrepresentable:tuplet-ratio',
        'inconsistent:voice',
      ])
    })
  })

  // The note the grace note leads into overlaps the half in the line the
  // grace note was read into, so the group goes back to the run's line,
  // which the run has filled.
  test('leaves a grace group that goes to a line with a full run outside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const warnings = new WarningCollector()
    const result = readValid(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          '<backup><duration>12</duration></backup>' +
          plain('A', 24, 'half') +
          '<backup><duration>12</duration></backup>' +
          grace +
          plain('G', 12, 'quarter'),
      ),
      warnings,
    )
    const [run, ...rest] = result.parts[0]?.measures[0]?.sequences[0]?.content ?? []

    expect(run?.kind === 'tuplet' && run.content).toHaveLength(3)
    expect(rest.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(warnings.list().map((w) => w.code)).toEqual(['inconsistent:voice'])
  })

  // The silence before G fills what the run in its line still counts room
  // for, so the silence goes inside the run, and the group after it.
  test('leaves a grace group that goes to a line the silence fills the run of outside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const warnings = new WarningCollector()
    const result = readValid(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<backup><duration>8</duration></backup>' +
          plain('A', 24, 'half') +
          '<backup><duration>12</duration></backup>' +
          grace +
          plain('G', 12, 'quarter'),
      ),
      warnings,
    )
    const [run, ...rest] = result.parts[0]?.measures[0]?.sequences[0]?.content ?? []

    expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'space',
    ])
    expect(rest.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(warnings.list().map((w) => w.code)).toEqual(['inconsistent:voice'])
  })

  // The run in the line the group leaves holds C and D before it, so the
  // run stays there, and the group joins the run in A's line.
  test('leaves a run that holds more than the grace group in the line it leaves', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const warnings = new WarningCollector()
    const result = readValid(
      measure(
        rated('A', 4, 'eighth') +
          '<backup><duration>4</duration></backup>' +
          rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<backup><duration>4</duration></backup>' +
          grace +
          rated('B', 4, 'eighth'),
      ),
      warnings,
    )
    const [taken, left] = result.parts[0]?.measures[0]?.sequences ?? []
    const run = taken?.content[0]
    const other = left?.content[0]

    expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual([
      'event',
      'grace',
      'event',
    ])
    expect(other?.kind === 'tuplet' && other.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
    ])
  })

  test('reaches over a grace group that goes to a line with a run that has room left', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const warnings = new WarningCollector()
    const result = readValid(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<backup><duration>8</duration></backup>' +
          plain('A', 24, 'half') +
          '<backup><duration>16</duration></backup>' +
          grace +
          rated('E', 4, 'eighth'),
      ),
      warnings,
    )
    const content = result.parts[0]?.measures[0]?.sequences[0]?.content
    const run = content?.[0]

    expect(content).toHaveLength(1)
    expect(run?.kind === 'tuplet' && run.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'grace',
      'event',
    ])
    expect(warnings.list().map((w) => w.code)).toEqual(['inconsistent:voice'])
  })

  /** A note of `units` divisions written as `type`, ending a tuplet it never opened. */
  const stopping = (step: string, units: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification><notations><tuplet type="stop"/></notations></note>'

  // Sources write stop markers with no start anywhere, some on every triplet
  // note. Such a marker has no bracket of its own to close. Where such a
  // marker stands at the end of what the ratio counts, the marker and the
  // ratio say the same thing.
  test('passes over a stop marker standing where the ratio ends the run', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth') + stopping('E', 4, 'eighth')),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // The marker states a grouping the ratio contradicts. The ratio is what is
  // converted, so the marker is reported.
  test('reports a stop marker standing short of what the ratio counts', () => {
    const { content, warnings } = read(
      measure(rated('C', 4, 'eighth') + stopping('D', 4, 'eighth') + rated('E', 4, 'eighth')),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tuplet'])
    expect(warnings[0]?.element).toBe('tuplet')
  })

  // A run with no bracket has no stop, so it is reported where it opened,
  // not at the note that ends it.
  test('reports a run it cannot draw at its first note', () => {
    const plain =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'
    const source = measure(['', rated('C', 4, 'eighth'), rated('D', 4, 'eighth'), plain].join('\n'))
    const { warnings } = read(source)

    expect(warnings.map((w) => [w.code, w.context.line])).toEqual([
      ['unrepresentable:tuplet-ratio', 2],
    ])
  })

  test('closes a group the measure ends inside rather than refusing', () => {
    const source = measure(rated('C', 4, 'eighth') + rated('D', 4, 'eighth'))
    const { content, warnings } = read(source)

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-ratio'])
    // No <tuplet> is written, so the loss is about the ratio's own element.
    expect(warnings[0]?.element).toBe('time-modification')
    convertValid(source)
  })

  // The refusal a grace note's ratio earns is the same inside such a run as
  // outside it: a run gathers notes by the time they take, and a grace note
  // takes none.
  test('rejects a grace note carrying a ratio inside the run', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'

    expect(readFailure(measure(rated('C', 4, 'eighth') + grace)).message).toContain(
      'grace note carries a tuplet ratio',
    )
  })

  // A note inside a bracket the source drew needs no value of its own for the
  // ratio to count: the bracket says where the tuplet runs. Sources write a
  // hidden rest that way, with a ratio and no <type>.
  test('leaves a valueless note inside a drawn bracket alone', () => {
    const valueless =
      '<note><rest/><duration>4</duration>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') + valueless + tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // A rest filling the measure stands in no bracket, so a stop on it closes
  // nothing.
  test('reports a stop on a rest that fills the measure', () => {
    const { content, warnings } = read(
      measure(
        '<note><rest measure="yes"/><duration>48</duration>' +
          '<notations><tuplet type="stop" number="1"/></notations></note>',
      ),
    )

    expect(content).toEqual([])
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'unsupported:element',
        'tuplet',
        'A <tuplet> on a rest that fills the measure closes no bracket, and is not converted.',
      ],
    ])
  })

  test('reports a stop on a rest written over a rest that fills the measure', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over =
      '<note><rest/><duration>12</duration><type>quarter</type>' +
      '<notations><tuplet type="stop" number="1"/></notations></note>'
    const { warnings } = read(measure(measureRest + over))

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['redundant:rest', 'rest'],
      ['redundant:rest', 'tuplet'],
    ])
  })

  // The rest is dropped before anything opens around it, so the bracket opens
  // nowhere and the next measure finds nothing to stop.
  test('reports a start on a rest written over a rest that fills the measure', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start" number="1"/></notations></note>'
    const next = ['C', 'D', 'E', 'F'].map((step) => bracketedNote(step)).join('')
    const { mnx, warnings } = convertValid(measures(DIVISIONS + measureRest + over, next))

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['redundant:rest', 'rest'],
      ['redundant:rest', 'tuplet'],
    ])
    expect(mnx.parts[0]?.measures.map((m) => m.sequences[0]?.content.length)).toEqual([0, 4])
  })

  // A run opens on the note's ratio, before the note turns out not to be an
  // event. It stands for no tuplet the source wrote.
  test('draws no tuplet for a run that holds nothing', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>'
    const { content, warnings } = read(measure(measureRest + over))

    expect(content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest'])
  })

  // A skip the ratio still counts room for stands in the group as a space,
  // which is how the same music reads when the source writes a rest there
  // rather than moving its cursor over it.
  test('reaches a group over a skip the ratio counts room for', () => {
    const skipped = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>4</duration></forward>' +
          rated('E', 4, 'eighth'),
      ),
    )
    const written = read(
      measure(
        rated('C', 4, 'eighth') +
          '<note><rest/><duration>4</duration><type>eighth</type>' +
          '<time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes></time-modification></note>' +
          rated('E', 4, 'eighth'),
      ),
    )
    const tuplet = skipped.content?.[0]

    expect(skipped.content).toHaveLength(1)
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'space',
      'event',
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.content[1]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 8 },
    })
    expect(skipped.warnings).toEqual([])
    // The rest spelling holds a rest where this holds a space, and both fill
    // the group the ratio counts.
    expect(written.content).toHaveLength(1)
    expect(written.warnings).toEqual([])
  })

  test('completes a group with a skip that fills what the ratio counts', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<forward><duration>4</duration></forward>' +
          plain('E', 12, 'quarter'),
      ),
    )
    const tuplet = content?.[0]

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'space',
    ])
    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(warnings).toEqual([])
  })

  test('completes a group with a skip that fills it before the next group', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<forward><duration>4</duration></forward>' +
          rated('E', 4, 'eighth') +
          rated('F', 4, 'eighth') +
          rated('G', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'tuplet'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(content?.[1]?.kind === 'tuplet' && content[1].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  test('leaves a grace note after a skip that fills the group outside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          '<forward><duration>4</duration></forward>' +
          grace +
          plain('E', 12, 'quarter'),
      ),
    )
    const tuplet = content?.[0]

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'grace', 'event'])
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'space',
    ])
    expect(warnings).toEqual([])
  })

  test('leaves a grace note written back over a full group outside it', () => {
    const grace =
      '<note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>'
    const { content } = read(
      measure(
        rated('C', 4, 'eighth') +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth') +
          '<backup><duration>4</duration></backup>' +
          grace +
          '<forward><duration>4</duration></forward>' +
          plain('G', 12, 'quarter'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'grace', 'event'])
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
  })

  // A run gathers notes that follow one another, and nothing the source drew
  // bounds it. A skip that carries the run past what its ratio counts cannot
  // stand inside it, so the run ends and the notes after start a new one.
  test('ends a group at a skip carrying it past what its ratio counts', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>24</duration></forward>' +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'space', 'tuplet'])
    expect(content?.[1]).toEqual({ kind: 'space', duration: { num: 1, den: 2 } })
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(1)
    expect(content?.[2]?.kind === 'tuplet' && content[2].content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:tuplet-ratio',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // A grace note takes none of the measure's time, so the run reaches over it,
  // but the skip standing before it still ends the run.
  test('ends a group at a skip a grace note stands after', () => {
    const graceNote =
      '<note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>eighth</type></note>'
    const { content } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<forward><duration>24</duration></forward>' +
          graceNote +
          rated('D', 4, 'eighth'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'space', 'grace', 'tuplet'])
    expect(content?.[1]).toEqual({ kind: 'space', duration: { num: 1, den: 2 } })
  })

  // A <backup> and a <forward> that cancel out move nothing. Sources write such
  // a pair inside a tuplet to place a <direction> earlier.
  test('reaches a group over a backup a forward takes back', () => {
    const { content, warnings } = read(
      measure(
        rated('C', 4, 'eighth') +
          '<backup><duration>4</duration></backup><forward><duration>4</duration></forward>' +
          rated('D', 4, 'eighth') +
          rated('E', 4, 'eighth'),
      ),
    )

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'tuplet' && content[0].content).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  // The dropped rests still stood somewhere, so the cursor moves on from
  // where each stood, and a second ratio opens a run of its own after the
  // first closes. The voice is a rest filling the measure and holds nothing,
  // so the time between them is no space: it would state silence inside a
  // sequence that has none.
  test('states no space between rests dropped over a measure rest', () => {
    const measureRest = '<note><rest measure="yes"/><duration>48</duration></note>'
    const over = (units: number, played: number, space: number) =>
      `<note><rest/><duration>${String(units)}</duration><type>eighth</type>` +
      `<time-modification><actual-notes>${String(played)}</actual-notes>` +
      `<normal-notes>${String(space)}</normal-notes></time-modification></note>`
    const { content, warnings } = read(measure(measureRest + over(4, 3, 2) + over(3, 2, 1)))

    expect(content).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['redundant:rest', 'redundant:rest'])
  })

  test('converts to MNX the schema accepts', () => {
    const notes = ['C', 'D', 'E', 'F', 'G', 'A'].map((step) => rated(step, 4, 'eighth')).join('')
    convertValid(measure(notes))
  })
})

// A run the ratio alone opens takes the notes that state the same ratio. Two
// ratios counting different numbers of the same value are different ratios,
// whatever they count them against.
describe('a run of notes stating ratios that count differently', () => {
  const rated = (step: string, units: number, actual: number) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification></note>'

  // Divisions of 24 to a quarter, so an eighth is 12: one under 4:2 lasts 6,
  // and one under 8:2 lasts 3. Both ratios count two of something in the
  // space they take, and they count a different number of eighths in it.
  const source = measures(
    '<attributes><divisions>24</divisions></attributes>' +
      rated('C', 6, 4) +
      rated('D', 6, 4) +
      rated('E', 3, 8) +
      rated('F', 3, 8),
  )

  test('ends the run where the count changes', () => {
    const { content, warnings } = read(source)

    expect(
      content?.map((item) =>
        item.kind === 'tuplet' ? [item.inner, item.content.length] : item.kind,
      ),
    ).toEqual([
      [{ value: { base: 'eighth', dots: 0 }, multiple: 2 }, 2],
      [{ value: { base: '16th', dots: 0 }, multiple: 4 }, 2],
    ])
    expect(warnings).toEqual([])
  })

  test('leaves output the schema takes', () => {
    convertValid(source)
  })
})
