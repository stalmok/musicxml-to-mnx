// Grace notes inside, before and after tuplet brackets.

import { describe, expect, test } from 'vitest'
import {
  bracketedNote,
  marker,
  measure,
  measures,
  tupletNote,
} from '../../tests/support/tuplets.js'
import { readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import type { SequenceItem } from '../model/score.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

describe('grace notes', () => {
  const grace = (step: string, extra = '') =>
    `<note><grace${extra}/><pitch><step>${step}</step><octave>5</octave></pitch>` +
    '<type>eighth</type></note>'
  const REAL =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
    '<type>quarter</type></note>'

  test('gathers the grace notes into a group before the note they lead to', () => {
    const { content } = read(measure(grace('B') + REAL))

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
  })

  test('keeps consecutive grace notes in one group', () => {
    const { content } = read(measure(grace('B') + grace('C') + REAL))
    const group = content?.[0]

    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    // None of them is drawn with a slash, so the group is not either: the
    // slash is carried from the notes that state one.
    expect(group?.kind === 'grace' && group.slashed).toBe(false)
  })

  test('notes when the group is drawn with a slash', () => {
    const { content } = read(measure(grace('B', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  // A bare grace element is an appoggiatura, drawn without a slash, and the
  // document states that: the schema declares no default for slash, so an
  // absent one is unspecified rather than false.
  test('converts a bare grace element to a group stating slash false', () => {
    const { mnx, warnings } = convertValid(measure(grace('B') + REAL))
    const item = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(item).toMatchObject({ type: 'grace', slash: false })
    expect(warnings).toEqual([])
  })

  test('marks the group as slashed even when the slash is on a later note', () => {
    const { content } = read(measure(grace('B') + grace('C', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  // Time the voice passed over in silence belongs before the group, not
  // after it: a grace note is squeezed in before the note it ornaments, so
  // stating the silence afterwards strands the group where the voice last
  // sounded rather than beside the note it decorates.
  test('states time passed over before the group, not after it', () => {
    const { content } = read(
      measure('<forward><duration>12</duration></forward>' + grace('B') + REAL),
    )

    expect(content?.map((item) => item.kind)).toEqual(['space', 'grace', 'event'])
  })

  test('still takes no time from the measure', () => {
    const { content } = read(measure(grace('B') + REAL + REAL))

    // Two quarters and a grace note fill a 2/4 bar; the grace note adds
    // nothing to that.
    expect(content?.filter((item) => item.kind === 'event')).toHaveLength(2)
  })

  // A bracket runs from its start marker to its stop, and both can sit on a
  // grace note. What it holds then takes none of the measure's time, which
  // MNX has no tuplet to state.
  const graceMarked = (step: string, mark: string) =>
    `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch><type>eighth</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${mark}"/></notations></note>`

  test('drops a bracket that opens and closes on one grace note', () => {
    const { content, warnings } = read(
      measure(
        '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
          '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
          '</time-modification>' +
          '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>' +
          REAL,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  test('drops a bracket that opens on one grace note and closes on the next', () => {
    const { content, warnings } = read(
      measure(graceMarked('B', 'start') + graceMarked('C', 'stop') + REAL),
    )

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    const group = content?.[0]
    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  // The note after the bracket was never inside it, and stays outside it.
  test('leaves the note after such a bracket out of it', () => {
    const { mnx, warnings } = convertValid(
      measure(graceMarked('B', 'start') + graceMarked('C', 'stop') + REAL),
    )
    const items = mnx.parts[0]?.measures?.[0]?.sequences?.[0]?.content

    expect(items?.map((item) => item.type)).toEqual(['grace', undefined])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tuplet-untimed'])
  })

  // A bracket the source drew over a grace note and the notes it ornaments
  // holds time, and is the tuplet the source stated.
  test('keeps a bracket that opens on a grace note and closes on a note', () => {
    const { content, warnings } = read(
      measure(
        graceMarked('B', 'start') +
          tupletNote('C', 4, 'eighth') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          REAL,
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'grace',
      'event',
      'event',
      'event',
    ])
    expect(warnings).toEqual([])
  })

  test('takes the whole group into a bracket a later grace note in it opens', () => {
    const { content, warnings } = read(
      measure(
        grace('A') +
          graceMarked('B', 'start') +
          tupletNote('C', 4, 'eighth') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          REAL,
      ),
    )
    const tuplet = content?.[0]
    const group = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'grace',
      'event',
      'event',
      'event',
    ])
    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  test('leaves a group before a note that opens a bracket outside the bracket', () => {
    const { content, warnings } = read(
      measure(
        grace('A') +
          tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop') +
          REAL,
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'tuplet', 'event'])
    expect(warnings).toEqual([])
  })

  // The bracket that closed on B holds A and B, so F starts a group of its own.
  test('leaves a group a bracket closed on out of the next bracket', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth') +
          grace('A') +
          graceMarked('B', 'stop') +
          graceMarked('F', 'start') +
          tupletNote('G', 4, 'eighth') +
          tupletNote('A', 4, 'eighth') +
          tupletNote('B', 4, 'eighth', 'stop'),
      ),
    )
    const [first, second] = content ?? []
    const groupSizes = [
      first?.kind === 'tuplet' && first.content[3],
      second?.kind === 'tuplet' && second.content[0],
    ].map((group) => group && group.kind === 'grace' && group.content.length)

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'tuplet'])
    expect(first?.kind === 'tuplet' && first.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
      'event',
      'grace',
    ])
    expect(second?.kind === 'tuplet' && second.content.map((item) => item.kind)).toEqual([
      'grace',
      'event',
      'event',
      'event',
    ])
    expect(groupSizes).toEqual([2, 1])
    expect(warnings).toEqual([])
  })

  // MusicXML states a side on each grace note, and MNX one for each group. A
  // grace note naming another side than the group before it, with no beam
  // joining them, starts a group of its own, inside the bracket it opens.
  const sided =
    (side: string, beam = '') =>
    (step: string, mark?: string) =>
      (mark ? graceMarked(step, mark) : grace(step))
        .replace('<grace/>', `<grace ${side}="10"/>`)
        .replace(mark ? '<notations>' : '</note>', `${beam}${mark ? '<notations>' : '</note>'}`)
  const TRIPLET_AFTER =
    tupletNote('C', 4, 'eighth') +
    tupletNote('D', 4, 'eighth') +
    tupletNote('E', 4, 'eighth', 'stop')

  test('leaves a group on another side outside a bracket a grace note opens', () => {
    const { content } = read(
      measure(
        sided('steal-time-following')('A') + sided('make-time')('B', 'start') + TRIPLET_AFTER,
      ),
    )
    const tuplet = content?.[1]
    const group = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'tuplet'])
    expect(group?.kind === 'grace' && [group.graceType, group.content.length]).toEqual([
      'makeTime',
      1,
    ])
  })

  // The beam is what the engraver drew, so the side already stated is kept.
  test('takes a group on another side beamed to the grace note into the bracket', () => {
    const { content, warnings } = read(
      measure(
        sided('steal-time-following', '<beam number="1">begin</beam>')('A') +
          sided('make-time', '<beam number="1">end</beam>')('B', 'start') +
          TRIPLET_AFTER,
      ),
    )
    const tuplet = content?.[0]
    const group = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(group?.kind === 'grace' && [group.graceType, group.content.length]).toEqual([
      'stealFollowing',
      2,
    ])
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:grace-time')
  })

  // Triplet eighths inside a triplet state 9:4, and last 8 of 36 divisions.
  test('takes the whole group into two brackets a later grace note in it opens', () => {
    const ratio = (played: number, space: number) =>
      `<time-modification><actual-notes>${String(played)}</actual-notes>` +
      `<normal-notes>${String(space)}</normal-notes></time-modification>`
    const stated =
      '<tuplet-actual><tuplet-number>3</tuplet-number></tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number></tuplet-normal>'
    const note = (step: string, units: number, extra: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(units)}</duration><type>eighth</type>${extra}</note>`
    const { content, warnings } = read(
      measures(
        '<attributes><divisions>36</divisions></attributes>' +
          grace('A') +
          '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
          ratio(9, 4) +
          `<notations><tuplet type="start" number="1">${stated}</tuplet>` +
          `<tuplet type="start" number="2">${stated}</tuplet></notations></note>` +
          note('C', 8, ratio(9, 4)) +
          note('D', 8, ratio(9, 4)) +
          note('E', 8, ratio(9, 4) + marker('stop', '2')) +
          note('F', 12, ratio(3, 2) + marker('stop', '1')),
      ),
    )
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined
    const group = inner?.kind === 'tuplet' ? inner.content[0] : undefined

    expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
    expect(outer?.kind === 'tuplet' && outer.content.map((item) => item.kind)).toEqual([
      'tuplet',
      'event',
    ])
    expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  // A group taking its time from the note before is drawn after that note.
  // B starts a group of its own inside the bracket.
  test('leaves a group taking its time from the note before outside the bracket', () => {
    const { content, warnings } = read(
      measure(
        REAL +
          grace('A', ' steal-time-previous="20"') +
          graceMarked('B', 'start') +
          tupletNote('C', 4, 'eighth') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[2]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

    expect(content?.map((item) => item.kind)).toEqual(['event', 'grace', 'tuplet'])
    expect(content?.[1]?.kind === 'grace' && content[1]).toMatchObject({
      graceType: 'stealPrevious',
      content: [{}],
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
      'grace',
      'event',
      'event',
      'event',
    ])
    expect(inside?.kind === 'grace' && inside.content).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:grace-time'])
  })

  // The note the grace note leads into overlaps the quarter before it, so it
  // takes a new line, and the bracket the grace note opened goes with it.
  describe('a bracket a grace note opens before a note that takes a new line', () => {
    const graceOpening =
      '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start" bracket="yes"/></notations></note>'
    const overlapping = bracketedNote('C') + '<backup><duration>12</duration></backup>'
    const plainEighth = (step: string, bracket = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>eighth</type>${bracket ? marker(bracket) : ''}</note>`

    function readLines(source: string) {
      const warnings = new WarningCollector()
      const result = readValid(source, warnings)
      const sequences = result.parts[0]?.measures[0]?.sequences ?? []
      return { lines: sequences.map((sequence) => sequence.content), warnings: warnings.list() }
    }

    test('moves the bracket into the new line with its notes', () => {
      const { lines, warnings } = readLines(
        measure(
          overlapping +
            graceOpening +
            tupletNote('D', 4, 'eighth') +
            tupletNote('E', 4, 'eighth') +
            tupletNote('F', 4, 'eighth', 'stop'),
        ),
      )
      const tuplet = lines[1]?.[0]

      expect(lines[0]?.map((item) => item.kind)).toEqual(['event'])
      expect(lines[1]?.map((item) => item.kind)).toEqual(['tuplet'])
      expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('yes')
      expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
        'grace',
        'event',
        'event',
        'event',
      ])
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
    })

    test('moves the whole group with a bracket a later grace note in it opens', () => {
      const { lines } = readLines(
        measure(
          overlapping +
            grace('A') +
            graceOpening +
            tupletNote('D', 4, 'eighth') +
            tupletNote('E', 4, 'eighth') +
            tupletNote('F', 4, 'eighth', 'stop'),
        ),
      )
      const tuplet = lines[1]?.[0]
      const group = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

      expect(lines[0]?.map((item) => item.kind)).toEqual(['event'])
      expect(lines[1]?.map((item) => item.kind)).toEqual(['tuplet'])
      expect(group?.kind === 'grace' && group.content).toHaveLength(2)
    })

    // B names another side than A with no beam joining them, so B's group
    // holds B alone, and the bracket moves with it.
    test('moves a bracket that holds only a group on its own side', () => {
      const { lines, warnings } = readLines(
        measure(
          overlapping +
            grace('A').replace('<grace/>', '<grace steal-time-following="10"/>') +
            graceOpening.replace('<grace/>', '<grace make-time="10"/>') +
            tupletNote('D', 4, 'eighth') +
            tupletNote('E', 4, 'eighth') +
            tupletNote('F', 4, 'eighth', 'stop'),
        ),
      )
      const tuplet = lines[1]?.[0]

      expect(lines[0]?.map((item) => item.kind)).toEqual(['event', 'grace'])
      expect(lines[1]?.map((item) => item.kind)).toEqual(['tuplet'])
      expect(tuplet?.kind === 'tuplet' && tuplet.bracket).toBe('yes')
      expect(tuplet?.kind === 'tuplet' && tuplet.content.map((item) => item.kind)).toEqual([
        'grace',
        'event',
        'event',
        'event',
      ])
      // Each side names an amount, which MNX has no home for.
      expect(
        warnings.map((w) => w.code).filter((code) => code !== 'unrepresentable:grace-time'),
      ).toEqual(['inconsistent:voice'])
    })

    // Triplet eighths inside a triplet state 9:4, and last 8 of 36 divisions.
    describe('a bracket that moves to a line with other brackets open', () => {
      const ratio = (played: number, space: number) =>
        `<time-modification><actual-notes>${String(played)}</actual-notes>` +
        `<normal-notes>${String(space)}</normal-notes></time-modification>`
      const note = (step: string, units: number, type: string, extra = '') =>
        `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
        `<duration>${String(units)}</duration><type>${type}</type>${extra}</note>`
      const backup = (units: number) => `<backup><duration>${String(units)}</duration></backup>`
      const STATED =
        '<tuplet-actual><tuplet-number>3</tuplet-number></tuplet-actual>' +
        '<tuplet-normal><tuplet-number>2</tuplet-number></tuplet-normal>'
      const opening = (played: number, space: number, stated = '') =>
        '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>eighth</type>' +
        ratio(played, space) +
        `<notations><tuplet type="start" number="2">${stated}</tuplet></notations></note>`
      const inner = (played: number, space: number, units: number) =>
        note('D', units, 'eighth', ratio(played, space)) +
        note('E', units, 'eighth', ratio(played, space)) +
        note(
          'F',
          units,
          'eighth',
          ratio(played, space) + '<notations><tuplet type="stop" number="2"/></notations>',
        )
      const triplet = (step: string, bracket = '') =>
        note('C', 24, 'quarter', ratio(3, 2) + (bracket ? marker(bracket) : '')).replace('C', step)

      // A's line holds the outer bracket. The grace note is read into the
      // half's line, which holds none, and D takes A's line.
      const intoBracket = (stated = '') =>
        measures(
          '<attributes><divisions>36</divisions></attributes>' +
            triplet('A', 'start') +
            backup(12) +
            note('G', 72, 'half') +
            backup(60) +
            opening(9, 4, stated) +
            inner(9, 4, 8) +
            triplet('B', 'stop'),
        )

      // The grace note is read into the line holding the outer bracket, and
      // D takes A's line, which holds none.
      const outOfBracket = (played: number, space: number, units: number, stated = '') =>
        measures(
          '<attributes><divisions>36</divisions></attributes>' +
            note('A', 36, 'quarter') +
            backup(36) +
            triplet('B', 'start') +
            triplet('C') +
            backup(12) +
            opening(played, space, stated) +
            inner(played, space, units) +
            backup(3 * units - 12) +
            triplet('G', 'stop'),
        )

      test('divides its ratio by the bracket open in the line it moves to', () => {
        const { lines, warnings } = readLines(intoBracket())
        const outer = lines[0]?.[0]
        const tuplet = outer?.kind === 'tuplet' ? outer.content[1] : undefined

        expect(outer?.kind === 'tuplet' && outer.content.map((item) => item.kind)).toEqual([
          'event',
          'tuplet',
          'event',
        ])
        expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual(
          [3, 2],
        )
        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      test('takes its whole ratio in a line with no bracket open', () => {
        const { lines, warnings } = readLines(outOfBracket(3, 2, 12))
        const tuplet = lines[0]?.[1]

        expect(lines[0]?.map((item) => item.kind)).toEqual(['event', 'tuplet'])
        expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual(
          [3, 2],
        )
        expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(4)
        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      // The marker's 3:2 disagrees with 9:4 in the half's line, and agrees
      // with it inside A's 3:2.
      test('checks a start marker against the line the bracket moves to', () => {
        const { warnings } = readLines(intoBracket(STATED))

        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      // A's line holds no bracket, and D overlaps A, so D takes a new line.
      const newLine = (graces: string, inside: string) =>
        measures(
          '<attributes><divisions>36</divisions></attributes>' +
            note('A', 36, 'quarter') +
            backup(36) +
            graces +
            inside +
            note('G', 12, 'eighth', ratio(3, 2) + marker('stop', '1')),
        )
      const grace = (step: string, played: number, space: number, starts: string) =>
        `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch><type>eighth</type>` +
        `${ratio(played, space)}<notations>${starts}</notations></note>`
      const start = (number: string, stated = '') =>
        `<tuplet type="start" number="${number}">${stated}</tuplet>`
      const nestedLevels = (lines: readonly (readonly SequenceItem[])[]) => {
        const outer = lines[1]?.[0]
        const tuplet = outer?.kind === 'tuplet' ? outer.content[0] : undefined
        return [outer, tuplet].map(
          (item) => item?.kind === 'tuplet' && [item.inner.multiple, item.outer.multiple],
        )
      }

      test('divides the note’s ratio between two brackets it opens that move', () => {
        const { lines, warnings } = readLines(
          newLine(grace('B', 9, 4, start('1', STATED) + start('2', STATED)), inner(9, 4, 8)),
        )

        expect(nestedLevels(lines)).toEqual([
          [3, 2],
          [3, 2],
        ])
        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      // Five sixteenths in the time of four inside three quarters in the time
      // of two state 15:8, and last 24 of 180 divisions.
      test('gives each bracket a note opens that moves its own marker’s share', () => {
        const portion = (side: string, count: number, type: string) =>
          `<tuplet-${side}><tuplet-number>${String(count)}</tuplet-number>` +
          `<tuplet-type>${type}</tuplet-type></tuplet-${side}>`
        const starts =
          start('1', portion('actual', 3, 'quarter') + portion('normal', 2, 'quarter')) +
          start('2', portion('actual', 5, '16th') + portion('normal', 4, '16th'))
        const sixteenth = (step: string, extra = '') => note(step, 24, '16th', ratio(15, 8) + extra)
        const quarter = (step: string, extra = '') =>
          note(step, 120, 'quarter', ratio(3, 2) + extra)
        const { lines, warnings } = readLines(
          measures(
            '<attributes><divisions>180</divisions></attributes>' +
              note('A', 180, 'quarter') +
              backup(180) +
              '<note><grace/><pitch><step>B</step><octave>5</octave></pitch><type>16th</type>' +
              `${ratio(15, 8)}<notations>${starts}</notations></note>` +
              sixteenth('C') +
              sixteenth('D') +
              sixteenth('E') +
              sixteenth('F') +
              sixteenth('G', marker('stop', '2')) +
              quarter('A') +
              quarter('B', marker('stop', '1')),
          ),
        )

        expect(nestedLevels(lines)).toEqual([
          [3, 2],
          [5, 4],
        ])
        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      test('divides the ratio of brackets two grace notes of one group open', () => {
        const { lines, warnings } = readLines(
          newLine(grace('B', 3, 2, start('1')) + grace('C', 9, 4, start('2')), inner(9, 4, 8)),
        )
        const outer = lines[1]?.[0]
        const tuplet = outer?.kind === 'tuplet' ? outer.content[0] : undefined
        const group = tuplet?.kind === 'tuplet' ? tuplet.content[0] : undefined

        expect(nestedLevels(lines)).toEqual([
          [3, 2],
          [3, 2],
        ])
        expect(group?.kind === 'grace' && group.content).toHaveLength(2)
        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
      })

      // With no marker to divide 9:4 between the two brackets, the outer one
      // takes all of it, so G lasts less than it states. The converter worked
      // that division out, so no note's <time-modification> is checked
      // against it.
      test('leaves the ratio of a bracket that moves unstated where none of it was', () => {
        const { warnings } = readLines(
          newLine(grace('B', 9, 4, start('1') + start('2')), inner(9, 4, 8)),
        )

        expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration', 'inconsistent:voice'])
      })

      // The markers' 3:2 and 3:2 disagree with the note's 3:2. The inner
      // bracket closes on A, over grace notes alone, before the outer one
      // moves with D.
      test('reports a start marker once where one of its brackets closed before moving', () => {
        const { warnings } = readLines(
          newLine(
            grace('B', 3, 2, start('1', STATED) + start('2', STATED)) +
              grace('A', 3, 2, '<tuplet type="stop" number="2"/>'),
            note('D', 12, 'eighth', ratio(3, 2)) + note('E', 12, 'eighth', ratio(3, 2)),
          ),
        )

        expect(warnings.map((w) => w.code)).toEqual([
          'inconsistent:tuplet',
          'unrepresentable:tuplet-untimed',
          'inconsistent:voice',
        ])
      })

      // The markers' 3:2 and 3:2 disagree with 27:8 in the half's line, where
      // A closes bracket 3. They agree with it inside the first triplet's 3:2,
      // where bracket 2 moves with D.
      test('checks a start marker against the line its last bracket moves to', () => {
        const graces =
          grace('B', 27, 8, start('2', STATED) + start('3', STATED)) +
          grace('A', 27, 8, '<tuplet type="stop" number="3"/>')
        const { warnings } = readLines(intoBracket(STATED).replace(opening(9, 4, STATED), graces))

        expect(warnings.map((w) => w.code)).toEqual([
          'unrepresentable:tuplet-untimed',
          'inconsistent:voice',
        ])
      })

      test('reports a start marker that disagrees in the line the bracket moves to', () => {
        const { warnings } = readLines(outOfBracket(9, 4, 8, STATED))

        // The marker is reported where the bracket opens, before what the
        // bracket turned out to hold.
        expect(warnings.map((w) => w.code)).toEqual([
          'inconsistent:tuplet',
          'inconsistent:tuplet',
          'inconsistent:voice',
        ])
        expect(warnings[0]).toMatchObject({ element: 'tuplet' })
        expect(warnings[0]?.message).toContain('start marker')
        expect(warnings[1]?.message).not.toContain('start marker')
      })
    })

    // The notes state no ratio, so the bracket takes the ratio the grace note
    // states, and counts the time it took from where the new line stood.
    test('scales the notes of the new line that state no ratio', () => {
      const { lines, warnings } = readLines(
        measure(
          overlapping +
            graceOpening +
            plainEighth('D') +
            plainEighth('E') +
            plainEighth('F', 'stop'),
        ),
      )
      const tuplet = lines[1]?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
        3, 2,
      ])
      expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(4)
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice'])
    })

    test('converts it to MNX the schema accepts, the bracket drawn in the new line', () => {
      const { mnx } = convertValid(
        measure(
          overlapping +
            graceOpening +
            tupletNote('D', 4, 'eighth') +
            tupletNote('E', 4, 'eighth') +
            tupletNote('F', 4, 'eighth', 'stop'),
        ),
      )
      const sequences = mnx.parts[0]?.measures[0]?.sequences

      expect(sequences?.[0]?.content.map((item) => item.type)).toEqual([undefined])
      expect(sequences?.[1]?.content[0]).toMatchObject({ type: 'tuplet', bracket: 'yes' })
    })
  })
})
