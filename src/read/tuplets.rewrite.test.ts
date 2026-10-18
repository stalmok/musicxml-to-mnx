// A bracket whose ratio the source leaves out, or whose ratio does not count
// what it holds, is given a ratio worked out from its notes. Where no ratio
// counts them, the bracket is dropped.

import { describe, expect, test } from 'vitest'
import { measure } from '../../tests/support/tuplets.js'
import { readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

// Engravers write a bracket with no ratio beside it. The note itself says
// what the ratio is, as how long it lasts against how it is written, so that
// is what is converted.
describe('a bracket the source states no ratio for', () => {
  /** A note of `units` divisions written as an eighth, bracketed or not. */
  const bare = (step: string, units: number, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'

  // Two eighths lasting an eighth each: a bracket that changes no duration,
  // which is drawn over what it holds and states two in the time of two.
  test('states a bracket over notes that play as written', () => {
    const { content, warnings } = read(measure(bare('C', 6, 'start') + bare('D', 6, 'stop')))
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
  })

  // Three eighths in the time of two, written by an exporter that left the
  // <time-modification> out. The durations say 3:2, so the tuplet does.
  test('reads the ratio of a triplet whose ratio was left out', () => {
    const { content, warnings } = read(
      measure(bare('C', 4, 'start') + bare('D', 4) + bare('E', 4, 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
    expect(warnings[0]?.message).toContain(
      'lasts 2/3 of what it is written as, so that is the ratio converted',
    )
  })

  // The bracket states what it holds against the time it takes, so a bracket
  // over two different values is counted in one that divides them both. Read
  // from its first note alone, it would state a half note of space where the
  // source has a quarter.
  test('counts a bracket over two different values in one that fits both', () => {
    const quarter =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
      '<type>quarter</type><notations><tuplet type="start"/></notations></note>'
    const eighth =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="stop"/></notations></note>'
    const { content } = read(measure(quarter + eighth))
    const tuplet = content?.[0]

    // Three eighths written, two eighths of space: the quarter and the eighth
    // together take one quarter of the measure, which is what they last.
    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 2,
    })
  })

  // Four eighths under a marker reading 3:2, sounding for eight thirds of an
  // eighth. No value counts both that and the four eighths written, so the
  // bracket counts the four it holds and keeps the two eighths of space its
  // own ratio gives it.
  test('counts a bracket whose ratio no value states over what it holds', () => {
    const stating =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal></tuplet></notations></note>'
    const { content, warnings } = read(
      measure(stating + bare('D', 4) + bare('E', 4) + bare('F', 4, 'stop')),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(4)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'unrepresentable:tuplet-ratio',
    ])
  })

  // A marker counting less than the bracket holds is restated over what it
  // holds: six eighths under a marker reading 3:2 are six in the time of four,
  // which sounds for the time the source gives them and counts what is there.
  test('states a marker that counts less than its bracket holds over the content', () => {
    const stating =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start">' +
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>2</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal></tuplet></notations></note>'
    const { content, warnings } = read(
      measure(
        stating + bare('D', 4) + bare('E', 4) + bare('F', 4) + bare('G', 4) + bare('A', 4, 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      6, 4,
    ])
    // Six eighths under a bracket that says three: the source's own
    // disagreement, reported as well as restated.
    expect(warnings.map((w) => w.code)).toEqual([
      'missing:time-modification',
      'inconsistent:tuplet',
    ])
  })

  // The counts a bracket states are worked out by halving the value it opened
  // with until both sides count whole, and where no halving does, by taking
  // the largest value that counts them both. The edges of that search are the
  // smallest count, the deepest halving, and a value the halvings never reach.
  describe('the counts a bracket is scaled to', () => {
    const at = (divisions: number, body: string) =>
      read(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>${String(divisions)}</divisions></attributes>` +
          `${body}</measure></part></score-partwise>`,
      )
    const note = (step: string, duration: number, type: string, markers = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(duration)}</duration><type>${type}</type>` +
      (markers ? `<notations>${markers}</notations>` : '') +
      '</note>'

    // One quarter played in the time of two is a count of one, which is a
    // count MusicXML writes: a bracket over a single note stretched to twice
    // its length. Counted from two upwards, the same bracket would be drawn
    // as two eighths in the time of four.
    test('states a count of one as one', () => {
      const { content } = at(
        12,
        note('C', 24, 'quarter', '<tuplet type="start"/><tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: 'quarter', dots: 0 }, multiple: 1 },
        { value: { base: 'quarter', dots: 0 }, multiple: 2 },
      ])
    })

    // A quarter and a 1024th together count whole in 1024ths and in nothing
    // longer, which is eight halvings down from the quarter the bracket
    // opened with: the last halving the search makes.
    test('reaches a value eight halvings down from the one it opened with', () => {
      const { content } = at(
        256,
        note('C', 128, 'quarter', '<tuplet type="start"/>') +
          note('D', 1, '1024th', '<tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: '1024th', dots: 0 }, multiple: 257 },
        { value: { base: '1024th', dots: 0 }, multiple: 129 },
      ])
    })

    // MNX puts no bound on how many of a value a tuplet counts, so a count
    // past a thousand is stated like any other.
    test('states a count past a thousand', () => {
      const { content, warnings } = at(
        256,
        note('C', 128, 'quarter', '<tuplet type="start"/>') +
          note('D', 512, 'whole') +
          note('E', 1, '1024th', '<tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: '1024th', dots: 0 }, multiple: 1281 },
        { value: { base: '1024th', dots: 0 }, multiple: 641 },
      ])
      expect(warnings.map((w) => w.code)).not.toContain('unrepresentable:tuplet-ratio')
    })

    test('counts the dotted value a <normal-dot> states', () => {
      const dotted = (step: string, markers = '') =>
        `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
        '<duration>9</duration><type>quarter</type><dot/>' +
        '<time-modification><actual-notes>4</actual-notes><normal-notes>3</normal-notes>' +
        '<normal-type>quarter</normal-type><normal-dot/></time-modification>' +
        (markers ? `<notations>${markers}</notations>` : '') +
        '</note>'
      const { content, warnings } = at(
        8,
        dotted('C', '<tuplet type="start"/>') +
          dotted('D') +
          dotted('E') +
          dotted('F', '<tuplet type="stop"/>'),
      )
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: 'quarter', dots: 1 }, multiple: 4 },
        { value: { base: 'quarter', dots: 1 }, multiple: 3 },
      ])
      expect(warnings).toEqual([])
    })

    // A bracket opening on a dotted value counts in dotted values as it
    // halves, so content no dotted value counts falls to the largest value
    // that counts both sides. Four quarters in the time of three dotted
    // quarters, cut after two, are four eighths in the time of three.
    test('counts in a value the halvings never reach', () => {
      const dotted = (step: string, markers = '') =>
        `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
        '<duration>9</duration><type>quarter</type>' +
        '<time-modification><actual-notes>4</actual-notes><normal-notes>3</normal-notes>' +
        '<normal-type>quarter</normal-type><normal-dot/></time-modification>' +
        (markers ? `<notations>${markers}</notations>` : '') +
        '</note>'
      const { content } = at(12, dotted('C', '<tuplet type="start"/>') + dotted('D'))
      const tuplet = content?.[0]

      expect(tuplet?.kind === 'tuplet' && [tuplet.inner, tuplet.outer]).toEqual([
        { value: { base: 'eighth', dots: 0 }, multiple: 4 },
        { value: { base: 'eighth', dots: 0 }, multiple: 3 },
      ])
    })
  })

  // A note whose length works out as a ratio no tuplet is written with is a
  // broken duration, not a bracket to be read.
  test('rejects a first note whose length is no ratio a tuplet would state', () => {
    const odd =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration>' +
      '<type>whole</type><notations><tuplet type="start"/></notations></note>'

    expect(readFailure(measure(odd)).message).toContain('no <time-modification>')
  })

  // Thirty-two either side is the largest count a derived ratio may reach.
  describe('the largest ratio a note may imply', () => {
    const bracketed = (divisions: number, type: string, duration: number) =>
      '<score-partwise><part id="P1"><measure number="1">' +
      `<attributes><divisions>${String(divisions)}</divisions></attributes>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${String(duration)}</duration>` +
      `<type>${type}</type>` +
      '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>' +
      '</measure></part></score-partwise>'

    // A whole note lasting a thirty-second is thirty-two in the time of one.
    test('reads a note implying thirty-two in the time of one', () => {
      const { content } = read(bracketed(8, 'whole', 1))

      expect(content?.[0]?.kind === 'tuplet' && content[0].inner.multiple).toBe(32)
    })

    test('refuses a note implying thirty-three in the time of one', () => {
      expect(readFailure(bracketed(33, 'whole', 4)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })

    // A thirty-second lasting a whole is one in the time of thirty-two.
    test('reads a note implying one in the time of thirty-two', () => {
      const { content } = read(bracketed(8, '32nd', 32))

      expect(content?.[0]?.kind === 'tuplet' && content[0].outer.multiple).toBe(32)
    })

    test('refuses a note implying one in the time of thirty-three', () => {
      expect(readFailure(bracketed(8, '32nd', 33)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })

    // A note lasting no time implies no ratio: there is nothing to divide its
    // written value by. The guard is stated at zero rather than below it,
    // because a duration is never negative and zero is the case that reaches
    // it.
    test('refuses a note that lasts no time at all', () => {
      expect(readFailure(bracketed(8, 'whole', 0)).message).toContain(
        'A tuplet starts on a note with no <time-modification>, and the note does not say ' +
          'how long it lasts against how it is written.',
      )
    })
  })

  test('writes MNX the spec schema accepts for one', () => {
    convertValid(measure(bare('C', 4, 'start') + bare('D', 4, 'stop')))
  })

  // Nothing says how one ratio would divide between two brackets, so the
  // document is refused.
  test('rejects two brackets opening together with no ratio', () => {
    const doubled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations><tuplet type="start" number="1"/>' +
      '<tuplet type="start" number="2"/></notations></note>'

    expect(readFailure(measure(doubled)).message).toContain('More than one tuplet starts')
  })

  // One marker stating its own ratio does not say what the other bracket's
  // share is, so the note is refused as soon as any of them leaves it open.
  test('rejects two brackets where only one states its own ratio', () => {
    const half =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>eighth</type><notations>' +
      '<tuplet type="start" number="1"><tuplet-actual><tuplet-number>3</tuplet-number>' +
      '<tuplet-type>eighth</tuplet-type></tuplet-actual></tuplet>' +
      '<tuplet type="start" number="2"/></notations></note>'

    expect(readFailure(measure(half)).message).toContain('More than one tuplet starts')
  })
})

// A bracket states its outer in the frame the brackets around it are written
// in, not in measure time. A run whose ratio came from its notes sits inside
// an enclosing bracket, whose ratio stands between the time the voice spent
// and the value the inner bracket has to state.
describe('a bracket with no stated ratio inside another bracket', () => {
  // Divisions of 36 to a quarter: an eighth is 18, a sixteenth 9. A triplet
  // eighth lasts 12, and inside a further triplet an eighth lasts 8 and a
  // sixteenth 4, so the inner bracket fills one triplet eighth.
  const nested = (body: string) =>
    read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>36</divisions></attributes>' +
        `${body}</measure></part></score-partwise>`,
    )
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>12</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  // No <time-modification>, so the ratio comes from how long the note lasts
  // against how it is written, which is the two levels multiplied.
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'
  // An eighth and a sixteenth: three sixteenths written, two sounded. The
  // first note alone says eighths, so the bracket is restated as it closes.
  const inner = innerNote('D', 8, 'eighth', 'start') + innerNote('E', 4, '16th', 'stop')

  test('counts the inner bracket in the frame its enclosing bracket writes', () => {
    const { content } = nested(outerNote('C', 'start') + inner + outerNote('G', 'stop'))
    const outer = content?.[0]
    const run = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(run?.kind === 'tuplet' && run.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(run?.kind === 'tuplet' && run.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('leaves the enclosing bracket holding the length its ratio states', () => {
    const { warnings } = nested(outerNote('C', 'start') + inner + outerNote('G', 'stop'))

    // Measured in measure time, the inner bracket states two eighths of space
    // where it takes two sixteenths, and the outer bracket comes out holding
    // four eighths under a ratio counting three.
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
  })
})

// A bracket rewritten over its content states its inner against the time it
// took, so the frame it writes is not the one its opening ratio stated. A
// bracket inside it is written in the frame the outer ends up with, not the
// opening one.
describe('a bracket rewritten inside a bracket that is rewritten too', () => {
  // Divisions of 36 to a quarter: an eighth is 18 and a sixteenth 9. Under
  // the outer 3:2 an eighth should last 12, and C and G last 18 instead, so
  // the outer bracket is rewritten over what it holds.
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>18</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'

  const nested = read(
    '<score-partwise><part id="P1"><measure number="1">' +
      '<attributes><divisions>36</divisions></attributes>' +
      outerNote('C', 'start') +
      innerNote('D', 12, 'eighth', 'start') +
      innerNote('E', 6, '16th', 'stop') +
      outerNote('G', 'stop') +
      '</measure></part></score-partwise>',
  )
  const outer = nested.content?.[0]
  const inner = outer?.kind === 'tuplet' ? outer.content[1] : undefined

  // C and G are written as eighths and last eighths, so the bracket holds
  // three eighths sounding three eighths.
  test('states the enclosing bracket over the time its notes take', () => {
    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 3,
    })
  })

  // The inner bracket holds three sixteenths and takes an eighth. The frame
  // around it scales nothing, so its outer is the two sixteenths that eighth
  // is written as there. Under the opening 3:2 it would be three, which the
  // rewritten outer would play as 3/20 of a whole note.
  test('writes the bracket inside it in the frame the outer ends up with', () => {
    expect(inner?.kind === 'tuplet' && inner.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('reports the source disagreeing with itself and nothing else', () => {
    expect(nested.warnings.map((w) => w.code)).toEqual([
      'inconsistent:duration',
      'missing:time-modification',
      'inconsistent:duration',
      'inconsistent:tuplet',
    ])
  })
})

// The same, with a skip among what the outer bracket holds. The skip was
// written at the ratios open when it was filled, so it says nothing about the
// frame the outer ends up with. Reading the frame off it would pull the
// bracket inside back toward the ratio the outer opened with.
describe('a bracket rewritten around a skip and a bracket rewritten too', () => {
  const outerNote = (step: string, bracket: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>18</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations><tuplet type="${bracket}" number="1"/></notations></note>`
  const innerNote = (step: string, units: number, type: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    (bracket ? `<notations><tuplet type="${bracket}" number="2"/></notations>` : '') +
    '</note>'

  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>36</divisions></attributes>' +
    outerNote('C', 'start') +
    innerNote('D', 12, 'eighth', 'start') +
    innerNote('E', 6, '16th', 'stop') +
    '<forward><duration>18</duration></forward>' +
    outerNote('G', 'stop') +
    '</measure></part></score-partwise>'
  const nested = read(source)
  const outer = nested.content?.[0]

  // C, G and the skipped eighth each last an eighth, and the bracket inside
  // takes another, so the bracket holds four eighths sounding four eighths.
  test('states the enclosing bracket over the time its notes take', () => {
    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 4,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: 'eighth', dots: 0 },
      multiple: 4,
    })
  })

  test('writes the skip at the rate the enclosing bracket settles on', () => {
    expect(outer?.kind === 'tuplet' && outer.content[2]).toEqual({
      kind: 'space',
      duration: { num: 1, den: 8 },
    })
  })

  test('leaves output the schema takes', () => {
    convertValid(source)
  })

  // The same reading the skipless bracket gives: three sixteenths in the time
  // of two. Counting the skip would give the outer seven
  // written sixteenths for every six of time. No pair of note values states
  // that over what this bracket holds, so the bracket keeps the three
  // sixteenths the opening ratio gave it, with nothing reported.
  test('writes the bracket inside it in the frame the outer ends up with', () => {
    const inner = outer?.kind === 'tuplet' ? outer.content[1] : undefined

    expect(inner?.kind === 'tuplet' && inner.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
    expect(inner?.kind === 'tuplet' && inner.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 2,
    })
  })

  test('reports the source disagreeing with itself and nothing else', () => {
    expect(nested.warnings.map((w) => w.code)).toEqual([
      'inconsistent:duration',
      'missing:time-modification',
      'inconsistent:duration',
      'inconsistent:tuplet',
    ])
  })
})

// A bracket holding nothing but another bracket says nothing about how much
// written length it uses for each unit of time, so the bracket inside it
// keeps the frame it was written in when it closed.
describe('a bracket whose whole content is one other bracket', () => {
  // Divisions of 12 to a quarter, so an eighth is 6. Both brackets open on
  // one note and close on the next, and the outer keeps the whole 3:2.
  const both = (step: string, units: number, markers: string) =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>eighth</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    `<notations>${markers}</notations></note>`
  const starts = '<tuplet type="start" number="1"/><tuplet type="start" number="2"/>'
  const stops = '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/>'

  const nested = (units: number) =>
    read(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>12</divisions></attributes>' +
        both('C', units, starts) +
        both('D', units, stops) +
        '</measure></part></score-partwise>',
    )

  // Each note lasts a quarter, so the pair takes half a whole note where the
  // ratio counts three eighths. The outer is rewritten to six eighths in the
  // time of four, and the inner keeps the six eighths of space the opening
  // 3:2 wrote it in.
  test('keeps the opening frame where nothing else fixes the rate', () => {
    const { content } = nested(12)
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([6, 4])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([2, 6])
  })

  // Here the pair takes the quarter the outer ratio counts, so the outer
  // stands as the source drew it and the inner is written in that.
  test('keeps the opening frame where the enclosing ratio stands', () => {
    const { content } = nested(6)
    const outer = content?.[0]
    const inner = outer?.kind === 'tuplet' ? outer.content[0] : undefined

    expect(outer?.kind === 'tuplet' && [outer.inner.multiple, outer.outer.multiple]).toEqual([3, 2])
    expect(inner?.kind === 'tuplet' && [inner.inner.multiple, inner.outer.multiple]).toEqual([2, 3])
  })
})

// A bracket states what it holds against the time it takes, and where no pair
// of note values counts that it takes the time its own ratio gives it
// instead. Where no pair of them counts that either, MNX can state no ratio
// over the content: a tuplet's content must come to its inner, and
// nothing writes an inner it comes to. The bracket is dropped and what it
// held stands where it stood.
describe('a bracket no pair of note values counts at all', () => {
  // Divisions of 128 to a quarter, so a whole note is 512 and a 128th is 4.
  // The ratio counts one whole note in the time of a triple-dotted 64th,
  // which is fifteen five-hundred-and-twelfths of a whole note. The bracket
  // holds five of those, and five against fifteen is counted only in a fifth
  // of a five-hundred-and-twelfth, which is no note value. Neither is five of
  // them, which is the largest length that counts both.
  const ratio =
    '<time-modification><actual-notes>512</actual-notes><normal-notes>15</normal-notes>' +
    '<normal-type>512th</normal-type></time-modification>'
  const stating =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>128th</type>${ratio}<notations><tuplet type="start">` +
    '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>whole</tuplet-type>' +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>' +
    '<tuplet-dot/><tuplet-dot/><tuplet-dot/></tuplet-normal></tuplet></notations></note>'
  const closing =
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>' +
    `<type>512th</type>${ratio}<notations><tuplet type="stop"/></notations></note>`
  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>128</divisions></attributes>' +
    stating +
    closing +
    '</measure></part></score-partwise>'

  test('writes what it held where it stood', () => {
    const { content } = read(source)

    expect(content?.map((item) => item.kind)).toEqual(['event', 'event'])
  })

  test('says no pair of note values counts what it holds either', () => {
    const { warnings } = read(source)
    const reported = warnings.find((w) => w.code === 'unrepresentable:tuplet-ratio')

    expect(reported?.message).toContain('so the tuplet is not converted')
  })

  test('leaves output the schema takes', () => {
    convertValid(source)
  })

  test('leaves what stands beside it where it stands', () => {
    const before =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>128</duration>' +
      '<type>quarter</type></note>'
    const { content } = read(source.replace(stating, before + stating))

    expect(content?.map((item) => item.kind)).toEqual(['event', 'event', 'event'])
  })
})

// A bracket dropped inside another leaves what it held where it stood, and
// what it held is not the length its outer stated. The bracket around it was
// measured before that happened, so a ratio that counted its content then
// need not count it after, and it is measured again.
describe('a bracket dropped inside one whose ratio counted it', () => {
  // Divisions of 128 to a quarter, so a whole note is 512. The outer bracket
  // counts one triple-dotted 64th, which is fifteen five-hundred-and-twelfths
  // of a whole note, and the inner bracket states exactly that much space, so
  // the outer counts what it holds. The inner bracket holds five of them.
  const ratio =
    '<time-modification><actual-notes>128</actual-notes><normal-notes>1</normal-notes>' +
    '<normal-type>128th</normal-type></time-modification>'
  const dotted = '<tuplet-dot/><tuplet-dot/><tuplet-dot/>'
  const starting =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>128th</type>${ratio}<notations>` +
    '<tuplet type="start" number="1">' +
    `<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>${dotted}` +
    '</tuplet-actual>' +
    '<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>128th</tuplet-type>' +
    '</tuplet-normal></tuplet>' +
    '<tuplet type="start" number="2">' +
    '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>whole</tuplet-type>' +
    '</tuplet-actual>' +
    `<tuplet-normal><tuplet-number>1</tuplet-number><tuplet-type>64th</tuplet-type>${dotted}` +
    '</tuplet-normal></tuplet></notations></note>'
  const closing =
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>' +
    `<type>512th</type>${ratio}<notations>` +
    '<tuplet type="stop" number="2"/><tuplet type="stop" number="1"/></notations></note>'
  const source =
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>128</divisions></attributes>' +
    starting +
    closing +
    '</measure></part></score-partwise>'

  test('counts the bracket around it over what it holds after the drop', () => {
    const { content } = read(source)
    const outer = content?.[0]

    expect(outer?.kind === 'tuplet' && outer.inner).toEqual({
      value: { base: '512th', dots: 0 },
      multiple: 5,
    })
    expect(outer?.kind === 'tuplet' && outer.outer).toEqual({
      value: { base: '512th', dots: 0 },
      multiple: 4,
    })
    expect(outer?.kind === 'tuplet' && outer.content.map((item) => item.kind)).toEqual([
      'event',
      'event',
    ])
  })

  // The wording comes from what the bracket holds once the drop has happened,
  // not from what it held before. The drop is the converter's doing, not the
  // source's.
  test('describes the bracket around it by what it holds after the drop', () => {
    const { warnings } = read(source)
    const reported = warnings.filter((w) => w.code === 'unrepresentable:tuplet-ratio')

    expect(reported.at(-1)?.message).toContain('falls short of')
  })

  test('leaves output the schema takes', () => {
    convertValid(source)
  })
})

// A ratio states two things: it counts what the bracket holds, and it gives
// the notes the time they take. A bracket whose content its ratio counts, but
// whose notes sound for a time that ratio does not give them, is rewritten
// over the time all the same, so that the measure adds up.
describe('a bracket whose notes take a time its ratio does not give them', () => {
  // Three eighths under 3:2, each lasting a 16th where the ratio makes an
  // eighth a twelfth of a whole note.
  const note = (step: string, bracket = '') =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>3</duration><type>eighth</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
    '</note>'
  const source = measure(note('C', 'start') + note('D') + note('E', 'stop'))

  test('states the bracket over the time its notes take', () => {
    const { content } = read(source)
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 6,
    })
    expect(tuplet?.kind === 'tuplet' && tuplet.outer).toEqual({
      value: { base: '16th', dots: 0 },
      multiple: 3,
    })
  })

  test('says the notes take less time than the stated ratio gives them', () => {
    const { warnings } = read(source)
    const reported = warnings.find((w) => w.code === 'inconsistent:tuplet')

    expect(reported?.message).toContain('take less time')
  })

  // The same eighths, each lasting a whole eighth.
  test('says the notes take more time than the stated ratio gives them', () => {
    const longer = source.replaceAll('<duration>3</duration>', '<duration>6</duration>')
    const { warnings } = read(longer)
    const reported = warnings.find((w) => w.code === 'inconsistent:tuplet')

    expect(reported?.message).toContain('take more time')
  })

  test('leaves output the schema takes', () => {
    convertValid(source)
  })
})

// A bracket opened in quarters is restated in the value it opened with,
// halved as far as a 1024th, before any other value is tried.
describe('a bracket restated in a value halved from the one it opened with', () => {
  test('counts in 1024ths, eight halvings from a quarter', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>256</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>9</duration>' +
        '<type>512th</type><dot/><time-modification><actual-notes>3</actual-notes>' +
        '<normal-notes>2</normal-notes><normal-type>quarter</normal-type></time-modification>' +
        '<notations><tuplet type="start"/><tuplet type="stop"/></notations></note>' +
        '</measure></part></score-partwise>',
    )
    const tuplet = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(tuplet && 'type' in tuplet && tuplet.type === 'tuplet' && tuplet.inner).toEqual({
      duration: { base: '1024th' },
      multiple: 3,
    })
    expect(tuplet && 'type' in tuplet && tuplet.type === 'tuplet' && tuplet.outer).toEqual({
      duration: { base: '1024th' },
      multiple: 9,
    })
  })
})
