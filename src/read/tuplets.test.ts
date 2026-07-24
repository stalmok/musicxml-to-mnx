// A tuplet is written with values longer than it sounds: three eighths played
// in the time of two. MusicXML says so twice, once as a ratio on every note
// (<time-modification>) and once as a bracket around them (<tuplet>). MNX
// wraps the notes in one object carrying the ratio.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

const DIVISIONS = '<attributes><divisions>12</divisions></attributes>'

/**
 * A note lasting `units` divisions, written as `type`, inside a 3:2 tuplet.
 * `bracket` places the start or stop marker.
 */
function tupletNote(step: string, units: number, type: string, bracket = ''): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'
  )
}

/** Three eighths in the time of two, which together fill one quarter. */
const TRIPLET =
  tupletNote('C', 4, 'eighth', 'start') +
  tupletNote('D', 4, 'eighth') +
  tupletNote('E', 4, 'eighth', 'stop')

function measure(body: string): string {
  return `<score-partwise><part id="P1"><measure number="1">${DIVISIONS}${body}</measure></part></score-partwise>`
}

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readScore(parseXmlRoot(source), warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

function readFailure(source: string): MusicXMLError {
  try {
    read(source)
  } catch (e) {
    if (e instanceof MusicXMLError) return e
    throw e
  }
  throw new Error('Expected the read to fail, but it succeeded.')
}

describe('tuplets', () => {
  test('wraps the notes in one tuplet', () => {
    const { content } = read(measure(TRIPLET))

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind).toBe('tuplet')
  })

  test('states what is played and the space it is played in', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
  })

  test('keeps the notes inside it, with the values they are written with', () => {
    const { content } = read(measure(TRIPLET))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside).toHaveLength(3)
    expect(inside[0]?.kind === 'event' && inside[0].value).toEqual({ base: 'eighth', dots: 0 })
  })

  test('takes only the time it really lasts from the measure', () => {
    // The triplet fills one quarter, so a following quarter completes a 2/4
    // bar rather than being pushed past the barline.
    const { content } = read(
      measure(
        TRIPLET +
          '<note><pitch><step>G</step><octave>4</octave></pitch>' +
          '<duration>12</duration><type>quarter</type></note>',
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['tuplet', 'event'])
  })

  test('reads a ratio whose written value differs from the notes inside', () => {
    const { content } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
          '<type>16th</type><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
          '<notations><tuplet type="start"/></notations></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration>' +
          '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
          '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
          '<notations><tuplet type="stop"/></notations></note>',
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.value).toEqual({ base: 'eighth', dots: 0 })
  })

  test('nests a tuplet inside another', () => {
    const inner =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>' +
      '<type>16th</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>'
    const { content } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          `${inner}<notations><tuplet type="start"/></notations></note>` +
          `${inner}</note>` +
          `${inner}<notations><tuplet type="stop"/></notations></note>` +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const outer = content?.[0]
    const nested = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(nested?.kind).toBe('tuplet')
  })

  // MusicXML allows a note to carry several <notations> blocks, and exporters
  // use that: a tie in one, a tuplet marker in another.
  test('finds a bracket in any of a note\u2019s notations blocks', () => {
    const withSecondBlock =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      '<notations><tied type="stop"/></notations>' +
      '<notations print-object="no"><tuplet type="start"/></notations></note>'
    const { content } = read(
      measure(
        withSecondBlock + tupletNote('D', 4, 'eighth') + tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )

    expect(content?.[0]?.kind).toBe('tuplet')
  })

  // A note inside a tuplet is meant to last less than it is written as; that
  // is what the ratio says. Only a duration that disagrees even through the
  // ratio is the source disagreeing with itself.
  test('says nothing about a duration the tuplet ratio accounts for', () => {
    const { warnings } = read(measure(TRIPLET))

    expect(warnings.filter((w) => w.code === 'inconsistent:duration')).toEqual([])
  })

  test('reports a duration that disagrees even through the tuplet ratio', () => {
    // Written as a quarter inside a 3:2 tuplet, so it should last 8 of the
    // measure's 12 divisions, but the source gives it 4. The quarter also
    // pushes the bracket's content past its ratio, which is reported over
    // the tuplet.
    const { warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          tupletNote('D', 4, 'quarter') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const inconsistent = warnings.filter((w) => w.code === 'inconsistent:duration')

    expect(inconsistent.filter((w) => w.element === 'note')).toHaveLength(1)
    expect(inconsistent.filter((w) => w.element === 'tuplet')).toHaveLength(1)
  })

  test('applies every open ratio to a note in a nested tuplet', () => {
    // Divisions of 18 make both levels exact: a triplet eighth is 6, and a
    // triplet 16th inside it is 2.
    const note18 = (step: string, units: number, type: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(units)}</duration><type>${type}</type>` +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const source =
      '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>18</divisions></attributes>' +
      note18('C', 6, 'eighth', 'start') +
      note18('D', 2, '16th', 'start') +
      note18('E', 2, '16th') +
      note18('F', 2, '16th', 'stop') +
      note18('G', 6, 'eighth', 'stop') +
      '</measure></part></score-partwise>'
    const { warnings } = read(source)

    expect(warnings.filter((w) => w.code === 'inconsistent:duration')).toEqual([])
  })

  // A voice that first sounds partway through the measure passes over the
  // time before that in silence. When its first note opens a tuplet, that
  // silence belongs before the bracket, not inside it, where the ratio would
  // scale it.
  test('puts the silence before a tuplet outside its bracket', () => {
    const other =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type><voice>1</voice></note>'
    const late = (step: string, bracket = ''): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>eighth</type><voice>2</voice>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification>' +
      (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
      '</note>'
    const warnings = new WarningCollector()
    const result = readScore(
      parseXmlRoot(measure(other + late('C', 'start') + late('D') + late('E', 'stop'))),
      warnings,
    )
    const content = result.parts[0]?.measures[0]?.sequences[1]?.content

    expect(content?.map((item) => item.kind)).toEqual(['space', 'tuplet'])
    expect(warnings.list().filter((w) => w.element === 'tuplet')).toEqual([])
  })

  // A gap inside the bracket, as a <forward> between its notes leaves, is
  // scaled by the ratio like everything else there, so the space that states
  // it has to be in written units: a skipped triplet eighth is written as an
  // eighth even though it lasts a twelfth of a whole note.
  test('states a gap inside the bracket in written values', () => {
    const { content, warnings } = read(
      measure(
        tupletNote('C', 4, 'eighth', 'start') +
          '<forward><duration>4</duration></forward>' +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(inside.map((item) => item.kind)).toEqual(['event', 'space', 'event'])
    expect(inside[1]?.kind === 'space' && inside[1].duration).toEqual({ num: 1, den: 8 })
    expect(warnings.filter((w) => w.element === 'tuplet')).toEqual([])
  })

  // Real scores contain brackets whose content does not add up to the stated
  // ratio: a lone quarter under a 3:2 eighth ratio, standing for a triplet
  // quarter. The content is converted as written, and the disagreement is
  // reported, because a consumer cannot tell how much time such a tuplet
  // means to take.
  test('reports a tuplet whose written content falls short of its ratio', () => {
    const partial =
      '<note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration>' +
      '<type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
      '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>'
    const { warnings } = read(measure(partial))

    expect(warnings.map((w) => ({ code: w.code, element: w.element }))).toEqual([
      { code: 'inconsistent:duration', element: 'tuplet' },
    ])
    expect(warnings[0]?.message).toContain('falls short')
  })

  test('reports a tuplet whose written content overruns its ratio', () => {
    const over =
      tupletNote('C', 4, 'eighth', 'start') +
      tupletNote('D', 4, 'eighth') +
      tupletNote('E', 4, 'eighth') +
      tupletNote('F', 4, 'eighth', 'stop')
    const { warnings } = read(measure(over))

    expect(warnings.map((w) => w.element)).toEqual(['tuplet'])
    expect(warnings[0]?.message).toContain('overruns')
  })

  test('rejects a tuplet the source never closes', () => {
    expect(
      readFailure(measure(tupletNote('C', 4, 'eighth', 'start') + tupletNote('D', 4, 'eighth')))
        .message,
    ).toContain('never closed')
  })

  test('rejects a stop with no tuplet open', () => {
    expect(readFailure(measure(tupletNote('C', 4, 'eighth', 'stop'))).message).toContain(
      'no tuplet is open',
    )
  })

  // Without brackets there is nothing to say where one tuplet ends and the
  // next begins, and guessing would invent a grouping the source never wrote.
  test('rejects a tuplet with no bracket to mark it', () => {
    expect(readFailure(measure(tupletNote('C', 4, 'eighth'))).message).toContain('bracket')
  })

  // A tremolo written across two notes carries <time-modification> as well,
  // and its written values overfill the measure exactly as a tuplet's do.
  test('rejects a tremolo written across two notes rather than reading it as a tuplet', () => {
    const tremolo =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>half</type><time-modification><actual-notes>2</actual-notes>' +
      '<normal-notes>1</normal-notes></time-modification>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(tremolo)).message).toContain('tremolo written across two notes')
  })

  // One written on a single note lasts what it is written as, so only the
  // ornament is lost.
  test('converts a note carrying a tremolo of its own', () => {
    const tremolo =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(tremolo))

    expect(content?.[0]?.kind === 'event' && content[0].value).toEqual({ base: 'half', dots: 0 })
    expect(warnings.map((w) => w.message)).toContain('<ornaments> is not converted yet.')
  })

  test('rejects a tuplet opening on a note that states no ratio', () => {
    const noRatio =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(noRatio)).message).toContain('no <time-modification>')
  })

  test('rejects a tuplet with no note value to count', () => {
    const noValue =
      '<note><rest/><duration>4</duration>' +
      '<time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>' +
      '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(noValue)).message).toContain('no note value to count')
  })

  test('rejects a normal-type it does not know', () => {
    const oddType =
      '<note><rest/><duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '<normal-type>triangle</normal-type></time-modification>' +
      '<notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(oddType)).message).toContain('Unknown note type "triangle"')
  })
})

describe('beam levels', () => {
  const beamed = (level: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>eighth</type><beam number="${level}">begin</beam></note>`

  test('reads a beam that states no level as the first one', () => {
    const { content } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>eighth</type><beam>begin</beam></note>' +
          '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>eighth</type><beam>end</beam></note>',
      ),
    )

    expect(content).toHaveLength(2)
  })

  test.each(['0', '99', 'first'])('rejects "%s" as a beam level', (level) => {
    expect(readFailure(measure(beamed(level))).message).toContain('not a beam level')
  })
})

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
  })

  test('notes when the group is drawn with a slash', () => {
    const { content } = read(measure(grace('B', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  test('marks the group as slashed even when the slash is on a later note', () => {
    const { content } = read(measure(grace('B') + grace('C', ' slash="yes"') + REAL))

    expect(content?.[0]?.kind === 'grace' && content[0].slashed).toBe(true)
  })

  test('still takes no time from the measure', () => {
    const { content } = read(measure(grace('B') + REAL + REAL))

    // Two quarters and a grace note fill a 2/4 bar; the grace note adds
    // nothing to that.
    expect(content?.filter((item) => item.kind === 'event')).toHaveLength(2)
  })
})
