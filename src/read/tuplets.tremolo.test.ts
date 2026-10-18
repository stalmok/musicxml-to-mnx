// A two-note tremolo states its pair's ratio in <time-modification>, the same
// element a tuplet uses, so the two are read together.

import { describe, expect, test } from 'vitest'
import {
  DIVISIONS,
  measure,
  measures,
  tremoloNote,
  tupletNote,
} from '../../tests/support/tuplets.js'
import { notesOf, readFailure, readValid } from '../../tests/support/read.js'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import type { SequenceItem } from '../model/score.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { content: result.parts[0]?.measures[0]?.sequences[0]?.content, warnings: warnings.list() }
}

// A tremolo written across two notes gives each the value of the pair while
// the pair occupies that value once, stated as the note's <duration> and a
// 2:1 <time-modification>. MNX gathers the pair into one tremolo item.
describe('two-note tremolos', () => {
  test('gathers the pair into one item, warning about nothing', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop')),
    )

    expect(content).toHaveLength(1)
    const item = content?.[0]
    expect(item?.kind === 'multiNoteTremolo' && item.marks).toBe(3)
    expect(item?.kind === 'multiNoteTremolo' && item.outer).toEqual({
      value: { base: 'quarter', dots: 0 },
      multiple: 2,
    })
    expect(
      item?.kind === 'multiNoteTremolo' && item.content.map((event) => event.value.base),
    ).toEqual(['half', 'half'])
    expect(warnings).toEqual([])
  })

  // The mark is usually drawn with three beams, and that is what an empty
  // element means.
  test('draws three beams where the source does not count them', () => {
    const { content } = read(measure(tremoloNote('C', 'start', '') + tremoloNote('E', 'stop', '')))

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(3)
  })

  // MusicXML multiplies the pair's 2:1 into the tuplet around it, so the
  // count played is even. A pair inside a triplet stating 3:2 left it out.
  describe('a ratio holding no 2:1', () => {
    const ratio = (played: number) =>
      `<time-modification><actual-notes>${String(played)}</actual-notes>` +
      '<normal-notes>2</normal-notes></time-modification>'
    // A quarter written, lasting half a triplet quarter.
    const pairNote = (step: string, type: string, played: number, extra = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      `<type>quarter</type>${ratio(played)}` +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments>${extra}` +
      '</notations></note>'
    const tripletNote = (step: string, units: number, type: string, extra = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(units)}</duration><type>${type}</type>${ratio(3)}${extra}</note>`
    const reported =
      'A note of a two-note tremolo states a <time-modification> of 3 in the time of 2, ' +
      'which holds no 2:1 for the tremolo. No share of the ratio is taken for the tremolo.'
    const tripletOf = (content: readonly SequenceItem[] | undefined) => {
      const [tuplet] = content ?? []
      return tuplet?.kind === 'tuplet'
        ? [tuplet.inner.multiple, tuplet.outer.multiple, tuplet.content.map((item) => item.kind)]
        : undefined
    }

    test('reads the ratio of a bracket the pair opens as the bracket’s own', () => {
      const stop = '<notations><tuplet type="stop"/></notations>'
      const { content, warnings } = read(
        measure(
          pairNote('C', 'start', 3, '<tuplet type="start"/>') +
            pairNote('E', 'stop', 3) +
            tripletNote('G', 8, 'quarter') +
            tripletNote('A', 8, 'quarter', stop),
        ),
      )

      expect(tripletOf(content)).toEqual([3, 2, ['multiNoteTremolo', 'event', 'event']])
      expect(warnings.map((w) => [w.code, w.element])).toEqual([
        ['inconsistent:tremolo', 'time-modification'],
        ['inconsistent:tuplet', 'time-modification'],
      ])
      expect(warnings[0]?.message).toBe(reported)
    })

    test('reads the ratio of a run the pair opens as the run’s own', () => {
      const { content, warnings } = read(
        measure(
          pairNote('C', 'start', 3) +
            pairNote('E', 'stop', 3) +
            tripletNote('G', 8, 'quarter') +
            tripletNote('A', 8, 'quarter'),
        ),
      )

      expect(content).toHaveLength(1)
      expect(tripletOf(content)).toEqual([3, 2, ['multiNoteTremolo', 'event', 'event']])
      expect(warnings.map((w) => w.message)).toEqual([reported])
    })

    test('reads the ratio of a stop where none is open as the run’s own', () => {
      const { content, warnings } = read(
        measure(
          pairNote('E', 'stop', 3) +
            tripletNote('F', 4, 'eighth') +
            tripletNote('G', 8, 'quarter') +
            tripletNote('A', 8, 'quarter'),
        ),
      )

      expect(content).toHaveLength(1)
      expect(tripletOf(content)).toEqual([3, 2, ['event', 'event', 'event', 'event']])
      expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo', 'inconsistent:tremolo'])
    })

    // One in the time of one holds no 2:1 and leaves no tuplet either.
    test('opens no tuplet for a pair stating one in the time of one', () => {
      const plain = (step: string, type: string) =>
        pairNote(step, type, 1)
          .replace('<duration>4', '<duration>6')
          .replace('<normal-notes>2', '<normal-notes>1')
      const { content, warnings } = read(measure(plain('C', 'start') + plain('E', 'stop')))

      expect(content?.map((item) => item.kind)).toEqual(['multiNoteTremolo'])
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tremolo', 'inconsistent:tuplet'])
    })

    // A grace note opens no pair, so its ratio is only the bracket's.
    test('reports a grace note starting a tremolo once', () => {
      const graceStart =
        '<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>quarter</type>' +
        `${ratio(3)}<notations><tuplet type="start"/>` +
        '<ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
      const stop = '<notations><tuplet type="stop"/></notations>'
      const { content, warnings } = read(
        measure(
          graceStart +
            tripletNote('C', 8, 'quarter') +
            tripletNote('D', 8, 'quarter') +
            tripletNote('E', 8, 'quarter', stop),
        ),
      )

      expect(tripletOf(content)).toEqual([3, 2, ['grace', 'event', 'event', 'event']])
      expect(warnings.map((w) => w.message)).toEqual([
        "A two-note tremolo starts on a grace note, which takes none of the measure's time, " +
          'so it cannot be one of the pair. The marker is not converted.',
      ])
    })
  })

  // Time the voice passed over in silence belongs before the tremolo. Stated
  // inside it, the pair would hold a space as well as its two notes, which is
  // no longer a pair.
  test('states time passed over before the pair, not inside it', () => {
    const { content, warnings } = read(
      measure(
        '<forward><duration>12</duration></forward>' +
          tremoloNote('C', 'start') +
          tremoloNote('E', 'stop'),
      ),
    )

    expect(content?.map((item) => item.kind)).toEqual(['space', 'multiNoteTremolo'])
    expect(warnings).toEqual([])
  })

  test('keeps the notes of a chord together under the tremolo', () => {
    const chord =
      '<note><chord/><pitch><step>G</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>half</type></note>'
    const { content } = read(
      measure(tremoloNote('C', 'start') + chord + tremoloNote('E', 'stop') + chord),
    )

    const item = content?.[0]
    expect(
      item?.kind === 'multiNoteTremolo' && item.content.map((event) => notesOf(event).length),
    ).toEqual([2, 2])
  })

  // Exporters draw the tremolo on a chord by writing it on every note of it.
  test('reads the marker every note of a chord carries as the chord’s own', () => {
    const member = (step: string, type: string, marks?: string) =>
      tremoloNote(step, type, marks).replace('<note>', '<note><chord/>')
    const { content, warnings } = read(
      measure(
        tremoloNote('C', 'start') +
          member('G', 'start') +
          tremoloNote('E', 'stop') +
          member('B', 'stop'),
      ),
    )

    const item = content?.[0]
    expect(
      item?.kind === 'multiNoteTremolo' && item.content.map((event) => notesOf(event).length),
    ).toEqual([2, 2])
    expect(warnings).toEqual([])
  })

  // An empty marker draws the usual three beams.
  test.each([
    ['', '3'],
    ['3', ''],
  ])('reads a restated marker counting "%s" where the chord’s counts "%s"', (member, own) => {
    const chord = tremoloNote('G', 'start', member).replace('<note>', '<note><chord/>')
    const { warnings } = read(
      measure(tremoloNote('C', 'start', own) + chord + tremoloNote('E', 'stop')),
    )

    expect(warnings).toEqual([])
  })

  test('reads a restated marker written with space around its count', () => {
    const member = tremoloNote('G', 'start', ' 3 ').replace('<note>', '<note><chord/>')
    const { warnings } = read(
      measure(tremoloNote('C', 'start') + member + tremoloNote('E', 'stop')),
    )

    expect(warnings).toEqual([])
  })

  test('reports a second marker on one note', () => {
    const twice = tremoloNote('C', 'start').replace(
      '</ornaments>',
      '<tremolo type="start">2</tremolo></ornaments>',
    )
    const { content, warnings } = read(measure(twice + tremoloNote('E', 'stop')))

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(3)
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unsupported:element', 'tremolo']])
  })

  test('reports a marker on a note of the chord drawn on the other side', () => {
    const drawn = (step: string, side: string) =>
      tremoloNote(step, 'start').replace('type="start"', `type="start" placement="${side}"`)
    const { warnings } = read(
      measure(
        drawn('C', 'above') +
          drawn('G', 'below').replace('<note>', '<note><chord/>') +
          tremoloNote('E', 'stop'),
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:element', 'tremolo'],
      ['inconsistent:tremolo', 'tremolo'],
    ])
  })

  test.each([
    ['counts other beams', '<tremolo type="start">2</tremolo>'],
    ['is drawn on a side', '<tremolo type="start" placement="above">3</tremolo>'],
    ['is the other end', '<tremolo type="stop">3</tremolo>'],
  ])('reports a marker on a note of the chord that %s', (_, marker) => {
    const member =
      '<note><chord/><pitch><step>G</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      `</time-modification><notations><ornaments>${marker}</ornaments></notations></note>`
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + member + tremoloNote('E', 'stop')),
    )

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
    expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
      [
        'inconsistent:tremolo',
        'tremolo',
        'A note of a chord carries a <tremolo> another way than the note it joins. MNX ' +
          "states the tremolo once for the chord, and the chord's own is the one converted.",
      ],
    ])
  })

  test('reports a stop marker on a note of the chord that counts other beams', () => {
    const member = tremoloNote('G', 'stop', '2').replace('<note>', '<note><chord/>')
    const { warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop') + member),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([['inconsistent:tremolo', 'tremolo']])
  })

  test('converts a tremolo that stops where none is open as a plain note', () => {
    const { content, warnings } = read(measure(tremoloNote('C', 'stop')))

    expect(content?.map((item) => item.kind === 'event' && item.value)).toEqual([
      { base: 'quarter', dots: 0 },
    ])
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:tremolo', 'tremolo']])
  })

  // A stop where none is open opens a tremolo around its own note, so its
  // ratio is read as a start's is, and a broken one refuses the file.
  test('reads the ratio a stop where none is open states', () => {
    const broken = tremoloNote('C', 'stop').replace(
      '<actual-notes>2</actual-notes>',
      '<actual-notes>0</actual-notes>',
    )

    expect(() => read(measure(broken))).toThrow(MusicXMLError)
  })

  describe('a stop where none is open, beside a tuplet', () => {
    const tripletEighth = (step: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>` +
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification></note>'
    // A quarter carrying the triplet's 3:2 and a pair's 2:1, as one 6:2.
    const tremoloInTriplet = (type: string) =>
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
      '<type>quarter</type><time-modification><actual-notes>6</actual-notes>' +
      '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations>` +
      '</note>'

    // The pair's share comes out of the ratio, as it does on a start, and
    // what is left keeps the note in the run.
    test('keeps its note in a run of ratios', () => {
      const { content, warnings } = read(
        measure(tripletEighth('C') + tripletEighth('D') + tremoloInTriplet('stop')),
      )

      const tuplet = content?.[0]
      expect(content).toHaveLength(1)
      expect(
        tuplet?.kind === 'tuplet' &&
          tuplet.content.map((item) => item.kind === 'event' && item.value.base),
      ).toEqual(['eighth', 'eighth', 'eighth'])
      expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo'])
    })

    // The tremolo is converted before the run is closed at the barline, so the
    // run is what its notes state rather than a bracket drawn past it.
    test('keeps a tremolo open at the barline in a run of ratios', () => {
      const { content, warnings } = read(
        measure(tripletEighth('C') + tripletEighth('D') + tremoloInTriplet('start')),
      )

      expect(content?.map((item) => item.kind)).toEqual(['tuplet'])
      expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo'])
    })

    // MuseScore draws each note of a pair inside a bracket of one in the time
    // of one, which scales nothing.
    test('passes over the bracket of one in the time of one around it', () => {
      const degenerate =
        '<note><pitch><step>E</step><octave>4</octave></pitch>' +
        '<duration>12</duration><type>half</type>' +
        '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
        '<normal-type>quarter</normal-type></time-modification>' +
        '<notations><tuplet type="start" bracket="no" show-number="none">' +
        '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>quarter</tuplet-type>' +
        '</tuplet-actual><tuplet-normal><tuplet-number>1</tuplet-number>' +
        '<tuplet-type>quarter</tuplet-type></tuplet-normal></tuplet>' +
        '<tuplet type="stop"/>' +
        '<ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'
      const { content, warnings } = read(measure(degenerate))

      expect(content?.map((item) => item.kind === 'event' && item.value.base)).toEqual(['quarter'])
      expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo', 'unsupported:element'])
    })
  })

  // A grace note takes none of the pair's time, so a stop on one opens
  // nothing, and the note after it is read as it is written.
  test('reports a stop on a grace note where none is open once', () => {
    const graceStop =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type>' +
      '<notations><ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'
    const quarter =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'
    const { content, warnings } = read(measure(graceStop + quarter))

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(content?.[1]?.kind === 'event' && content[1].value.base).toBe('quarter')
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:tremolo', 'tremolo']])
  })

  // The note written as a half lasts a quarter, so it is converted as one.
  test('converts a tremolo still open at the barline as a plain note', () => {
    const quarter =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'
    const { content, warnings } = read(
      measure(quarter + quarter + quarter + tremoloNote('C', 'start')),
    )

    expect(content?.map((item) => item.kind === 'event' && item.value.base)).toEqual([
      'quarter',
      'quarter',
      'quarter',
      'quarter',
    ])
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:tremolo', 'tremolo']])
  })

  test('converts a tremolo the next note does not stop as a plain note', () => {
    const quarter =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'
    const { content, warnings } = read(measure(tremoloNote('C', 'start') + quarter))

    expect(content?.map((item) => item.kind === 'event' && item.value.base)).toEqual([
      'quarter',
      'quarter',
    ])
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:tremolo', 'tremolo']])
  })

  test('converts a tremolo a second start follows as a plain note', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('D', 'start') + tremoloNote('E', 'stop')),
    )

    expect(content?.map((item) => item.kind)).toEqual(['event', 'multiNoteTremolo'])
    expect(content?.[0]?.kind === 'event' && content[0].value).toEqual({
      base: 'quarter',
      dots: 0,
    })
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:tremolo', 'tremolo']])
  })

  test('keeps the chord of a tremolo still open at the barline', () => {
    const member = tremoloNote('G', 'start').replace('<note>', '<note><chord/>')
    const { content } = read(measure(tremoloNote('C', 'start') + member))

    const item = content?.[0]
    expect(item?.kind === 'event' && [item.value.base, notesOf(item).length]).toEqual([
      'quarter',
      2,
    ])
  })

  describe('a tremolo the barline cuts', () => {
    const quarter =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'

    function readBoth(...bodies: string[]) {
      const warnings = new WarningCollector()
      const score = readValid(measures(DIVISIONS + bodies[0], ...bodies.slice(1)), warnings)
      return { measures: score.parts[0]?.measures, warnings: warnings.list() }
    }

    const valuesOf = (content: readonly SequenceItem[] | undefined) =>
      content?.map((item) => item.kind === 'event' && item.value.base)

    test('reports the tremolo once, where the barline cuts it', () => {
      const { measures: read, warnings } = readBoth(
        quarter + quarter + quarter + tremoloNote('C', 'start'),
        tremoloNote('E', 'stop') + quarter + quarter + quarter,
      )

      expect(valuesOf(read?.[1]?.sequences[0]?.content)).toEqual([
        'quarter',
        'quarter',
        'quarter',
        'quarter',
      ])
      expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([['unclosed:tremolo', 1]])
    })

    // A grace note takes none of the pair's time, but the stop it carries is
    // still the end the barline cut off.
    test('reports the tremolo once where a grace note carries its stop', () => {
      const graceStop =
        '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type>' +
        '<notations><ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'
      const { warnings } = readBoth(
        quarter + quarter + quarter + tremoloNote('C', 'start'),
        graceStop + quarter + quarter + quarter + quarter,
      )

      expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([['unclosed:tremolo', 1]])
    })

    // A grace note takes none of the pair's time, so the note after it is
    // still the voice's first.
    test('reports the tremolo once where a grace note comes before its stop', () => {
      const grace =
        '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>'
      const { warnings } = readBoth(
        quarter + quarter + quarter + tremoloNote('C', 'start'),
        grace + tremoloNote('E', 'stop') + quarter + quarter + quarter,
      )

      expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([['unclosed:tremolo', 1]])
    })

    // The stop belongs to the voice the tremolo opened in.
    test('reports a stop in another voice', () => {
      const { warnings } = readBoth(
        quarter + quarter + quarter + tremoloNote('C', 'start'),
        tremoloNote('E', 'stop').replace('</pitch>', '</pitch><voice>2</voice>') +
          quarter.replace('</pitch>', '</pitch><voice>2</voice>').repeat(3),
      )

      expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
        ['unclosed:tremolo', 1],
        ['unclosed:tremolo', 2],
      ])
    })

    // The next note of the voice is the one that stops it, or none does.
    test('reports a stop after the first note of the next measure', () => {
      const { warnings } = readBoth(
        quarter + quarter + quarter + tremoloNote('C', 'start'),
        quarter + tremoloNote('E', 'stop') + quarter + quarter,
      )

      expect(warnings.map((w) => [w.code, w.context.measure])).toEqual([
        ['unclosed:tremolo', 1],
        ['unclosed:tremolo', 2],
      ])
    })
  })

  // A grace note takes none of the pair's time, so its value stands.
  test('keeps a grace note a tremolo with one end gathered as it is written', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch>' + '<type>eighth</type></note>'
    const quarter =
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration>' +
      '<type>quarter</type></note>'
    const { content, warnings } = read(measure(tremoloNote('C', 'start') + grace + quarter))

    expect(content?.map((item) => item.kind)).toEqual(['event', 'grace', 'event'])
    const group = content?.[1]
    expect(group?.kind === 'grace' && group.content[0]?.value).toEqual({
      base: 'eighth',
      dots: 0,
    })
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo'])
  })

  // A 1024th is the shortest value MusicXML and MNX write, so half of one
  // has no value to write.
  test('rejects a tremolo left open on notes no value is half of', () => {
    const shortest =
      '<attributes><divisions>1024</divisions></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>' +
      '<type>1024th</type><time-modification><actual-notes>2</actual-notes>' +
      '<normal-notes>1</normal-notes></time-modification><notations><ornaments>' +
      '<tremolo type="start">1</tremolo></ornaments></notations></note>'

    expect(readFailure(measures(shortest)).message).toContain(
      'A note of a tremolo with one end is written as a 1024th, and no note value is half of it.',
    )
  })

  // A tremolo holds its two notes and nothing else. A rest passed over
  // between them is a space in the tremolo, which is neither of the two
  // notes and leaves the pair no longer a pair.
  test('rejects a pair with time passed over between them', () => {
    expect(
      readFailure(
        measure(
          tremoloNote('C', 'start') +
            '<forward><duration>12</duration></forward>' +
            tremoloNote('E', 'stop'),
        ),
      ).message,
    ).toContain('holds something other than two notes')
  })

  // A grace note takes none of the measure's time, so it cannot be one of the
  // pair, and the stop is the only end the pair has.
  test('reports a pair opening on a grace note, and converts its stop as a plain note', () => {
    const graceStart =
      '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>half</type>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(graceStart + tremoloNote('E', 'stop')))

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(content?.[1]?.kind === 'event' && content[1].value.base).toBe('quarter')
    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['inconsistent:tremolo', 'tremolo'],
      ['unclosed:tremolo', 'tremolo'],
    ])
  })

  // The 6:2 counts the pair's 2:1 with the bracket's 3:2, as it does on a
  // note that opens both.
  test('takes the pair’s share out of a bracket a grace note marking a pair opens', () => {
    const graceStart =
      '<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>' +
      '<time-modification><actual-notes>6</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"/>' +
      '<ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(
      measure(
        graceStart +
          tupletNote('C', 4, 'eighth') +
          tupletNote('D', 4, 'eighth') +
          tupletNote('E', 4, 'eighth', 'stop'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && [tuplet.inner.multiple, tuplet.outer.multiple]).toEqual([
      3, 2,
    ])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tremolo'])
  })

  test('rejects a pair whose notes last different times', () => {
    const shorter =
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration>' +
      '<type>quarter</type><notations><ornaments><tremolo type="stop">3</tremolo>' +
      '</ornaments></notations></note>'

    expect(readFailure(measure(tremoloNote('C', 'start') + shorter)).message).toContain(
      'last different times',
    )
  })

  test.each(['1', '8'])('draws a pair counting %s beams', (marks) => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start', marks) + tremoloNote('E', 'stop', marks)),
    )

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(Number(marks))
    expect(warnings).toEqual([])
  })

  // The pair still converts, drawn the usual way, and the loss is reported:
  // zero beams as a count MNX cannot state, nine as one MusicXML does not
  // define.
  test.each([
    ['0', 'unrepresentable:element'],
    ['9', 'unresolved:element-value'],
  ])('draws three beams where the stated count is %s', (marks, code) => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start', marks) + tremoloNote('E', 'stop', marks)),
    )

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual([code, code])
  })

  // Both ends count the beams joining the pair, and there is one pair to
  // draw.
  test('reports ends that count different beams, keeping the start', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start', '2') + tremoloNote('E', 'stop', '4')),
    )

    expect(content?.[0]?.kind === 'multiNoteTremolo' && content[0].marks).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:tremolo'])
  })

  // MNX has nowhere on a two-note tremolo to say which side it is drawn on.
  test('reports a placement the pair cannot carry', () => {
    const placed =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start" placement="above">3</tremolo>' +
      '</ornaments></notations></note>'
    const { content, warnings } = read(measure(placed + tremoloNote('E', 'stop')))

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  // A tuplet edge and a tremolo edge can fall on different notes. Popping the
  // wrong frame would lose notes, so both directions refuse.
  test('rejects a tuplet closing inside a tremolo', () => {
    const opens =
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"/></notations></note>'
    const closesBoth =
      '<note><pitch><step>D</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="stop"/>' +
      '<ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(opens + closesBoth)).message).toContain(
      'closes inside a two-note tremolo',
    )
  })

  test('rejects a tuplet starting inside a tremolo', () => {
    const startsBoth =
      '<note><pitch><step>E</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>eighth</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification><notations><tuplet type="start"/>' +
      '<ornaments><tremolo type="stop">3</tremolo></ornaments></notations></note>'

    expect(readFailure(measure(tremoloNote('C', 'start') + startsBoth)).message).toContain(
      'starts inside a two-note tremolo',
    )
  })

  // MuseScore writes a two-note tremolo's own pair as a degenerate bracket on
  // each note: eight sixteenths in the time of eight sixteenths, drawn with
  // neither bracket nor number. MNX holds the pair as one item, so the
  // bracket has no home, and it scales nothing, so passing it over
  // adds no duration.
  test('passes over a bracket of one in the time of one around a tremolo note', () => {
    const degenerate = (step: string, edge: string): string =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>12</duration><type>half</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '<normal-type>quarter</normal-type></time-modification>' +
      '<notations><tuplet type="start" bracket="no" show-number="none">' +
      '<tuplet-actual><tuplet-number>1</tuplet-number><tuplet-type>quarter</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>1</tuplet-number>' +
      '<tuplet-type>quarter</tuplet-type></tuplet-normal></tuplet>' +
      '<tuplet type="stop"/>' +
      `<ornaments><tremolo type="${edge}">3</tremolo></ornaments></notations></note>`

    const { content, warnings } = read(measure(degenerate('C', 'start') + degenerate('E', 'stop')))

    expect(content?.[0]?.kind).toBe('multiNoteTremolo')
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element', 'unsupported:element'])
    expect(warnings[0]?.message).toContain('one note of a two-note tremolo')
  })

  // An unmeasured tremolo names no beam count.
  test('reports an unmeasured tremolo, which MNX cannot state', () => {
    const unmeasured =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="unmeasured"/></ornaments></notations></note>'
    const { content, warnings } = read(measure(unmeasured))

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
    expect(warnings[0]?.message).toContain('unmeasured')
  })

  // A pair may sit inside a tuplet, its bracket starting and stopping on the
  // same notes as the tremolo. The bracket is the outer grouping, and inside
  // it the tremolo's time is stated in the written values the ratio scales: a
  // pair of dotted quarters standing for three eighths in the time of two
  // occupies two written dotted eighths.
  //
  // <time-modification> counts the tuplet and the tremolo together, so the
  // triplet's 3:2 and the pair's 2:1 are written as one 6:2.
  test('nests a tremolo inside a tuplet whose bracket rides the same notes', () => {
    const note = (step: string, edge: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>6</duration><type>quarter</type><dot/>' +
      '<time-modification><actual-notes>6</actual-notes><normal-notes>2</normal-notes>' +
      '<normal-type>eighth</normal-type></time-modification>' +
      `<notations><tuplet type="${edge}"/>` +
      `<ornaments><tremolo type="${edge}">3</tremolo>` +
      '</ornaments></notations></note>'
    const { content, warnings } = read(measure(note('C', 'start') + note('E', 'stop')))

    expect(content?.[0]?.kind).toBe('tuplet')
    const inner = content?.[0]?.kind === 'tuplet' ? content[0].content[0] : undefined
    expect(inner?.kind).toBe('multiNoteTremolo')
    expect(inner?.kind === 'multiNoteTremolo' && inner.outer).toEqual({
      value: { base: 'eighth', dots: 1 },
      multiple: 2,
    })
    expect(warnings).toEqual([])
  })

  // A grace note opens no pair, so the pair it stands in stays open, and
  // the grace note is gathered into it. A grace note inside a pair is
  // refused, with or without the marker.
  test('refuses a tremolo starting on a grace note inside another as a grace note there', () => {
    const graceStart =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>half</type>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>half</type></note>'
    const marked = readFailure(
      measure(tremoloNote('C', 'start') + graceStart + tremoloNote('E', 'stop')),
    )
    const plain = readFailure(measure(tremoloNote('C', 'start') + grace + tremoloNote('E', 'stop')))

    expect(marked.message).toContain('holds something other than two notes')
    expect(marked.message).toBe(plain.message)
  })

  // A note between the pair is not its second note, so each end is left on
  // its own.
  test('converts a pair a note comes between as plain notes', () => {
    const between =
      '<note><pitch><step>D</step><octave>4</octave></pitch>' +
      '<duration>12</duration><type>quarter</type></note>'
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + between + tremoloNote('E', 'stop')),
    )

    expect(content?.map((item) => item.kind === 'event' && item.value.base)).toEqual([
      'quarter',
      'quarter',
      'quarter',
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:tremolo', 'unclosed:tremolo'])
  })

  test('rejects a pair whose time no note value can write', () => {
    const third = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      '<duration>4</duration><type>half</type>' +
      `<notations><ornaments><tremolo type="${type}">3</tremolo></ornaments></notations></note>`

    expect(readFailure(measure(third('C', 'start') + third('E', 'stop'))).message).toContain(
      'no note value can write',
    )
  })

  // A bare <tremolo/> is a single-note tremolo, drawn the usual way: single
  // is MusicXML's default type, and three beams is how the mark is drawn
  // where the source does not count them.
  test('reads a tremolo that states neither type nor count', () => {
    const bare =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type><notations><ornaments><tremolo/></ornaments></notations></note>'
    const { content, warnings } = read(measure(bare))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo).toEqual({
      placement: undefined,
      marks: 3,
    })
    expect(warnings).toEqual([])
  })

  // Zero beams write an unmeasured tremolo, which MNX cannot state.
  test('reports a single-note tremolo drawn with no beams', () => {
    const unmeasured =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">0</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(unmeasured))

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })

  // MusicXML counts a tremolo's beams from zero to eight, and MNX from one.
  const tremoloOf = (marks: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
    '<type>half</type>' +
    `<notations><ornaments><tremolo type="single">${marks}</tremolo></ornaments></notations></note>`

  test.each(['1', '8'])('draws a tremolo counting %s beams', (marks) => {
    const { content, warnings } = read(measure(tremoloOf(marks)))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo?.marks).toBe(Number(marks))
    expect(warnings).toEqual([])
  })

  // Number() reads the first three as three.
  test.each(['0x3', '3e0', '3.0', '9', '-1', 'three'])(
    'reports a tremolo counting "%s" beams, which MusicXML does not define',
    (marks) => {
      const { content, warnings } = read(measure(tremoloOf(marks)))

      expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
      expect(warnings.map((w) => [w.code, w.message])).toEqual([
        [
          'unresolved:element-value',
          `A <tremolo> of "${marks}" is not one MusicXML defines, and the tremolo is not converted.`,
        ],
      ])
    },
  )

  test('reports a tremolo of a type MusicXML does not define', () => {
    const { content, warnings } = read(
      measure(tremoloOf('3').replace('type="single"', 'type="double"')),
    )

    expect(content?.[0]?.kind === 'event' && content[0].markings).toEqual({})
    expect(warnings.map((w) => [w.code, w.attribute, w.message])).toEqual([
      [
        'unresolved:attribute-value',
        'type',
        'A <tremolo> of type "double" is not one MusicXML defines, and the tremolo is not converted.',
      ],
    ])
  })

  test('keeps the first of two single-note tremolos', () => {
    const doubled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>' +
      '<type>half</type>' +
      '<notations><ornaments><tremolo type="single">3</tremolo>' +
      '<tremolo type="single">2</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(doubled))

    expect(content?.[0]?.kind === 'event' && content[0].markings.tremolo?.marks).toBe(3)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:marking'])
  })
})

// MusicXML's <time-modification> is cumulative, so a note that both opens a
// bracket and starts a two-note tremolo states the two ratios multiplied
// together: 6:2 for a tremolo inside a triplet. The tremolo's own share is
// not the bracket's to keep.
describe('a tuplet opening on the note that starts a tremolo', () => {
  // A triplet of quarters whose first quarter is a two-note tremolo. Each
  // note of the pair is written as a quarter and lasts a third of one.
  const inTriplet = (duration: number, actual: number, notations: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><type>quarter</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification>' +
    `<notations>${notations}</notations></note>`
  const tremoloPair = (opening: string) =>
    inTriplet(4, 6, `${opening}<ornaments><tremolo type="start">3</tremolo></ornaments>`) +
    inTriplet(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>')
  const closing = inTriplet(8, 3, '') + inTriplet(8, 3, '<tuplet type="stop"/>')

  test('states the ratio the bracket draws, with the tremolo inside it', () => {
    const { content, warnings } = read(measure(tremoloPair('<tuplet type="start"/>') + closing))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(inside.map((item) => item.kind)).toEqual(['multiNoteTremolo', 'event', 'event'])
    expect(warnings).toEqual([])
  })

  test('reads it as a bracket an earlier note opens is read', () => {
    const opened = read(measure(tremoloPair('<tuplet type="start"/>') + closing))
    const earlier = read(
      measure(
        inTriplet(8, 3, '<tuplet type="start"/>') +
          tremoloPair('') +
          inTriplet(8, 3, '<tuplet type="stop"/>'),
      ),
    )
    const ratioOf = (result: typeof opened) => {
      const tuplet = result.content?.[0]
      return tuplet?.kind === 'tuplet' ? [tuplet.inner.multiple, tuplet.outer.multiple] : []
    }

    expect(ratioOf(earlier)).toEqual([3, 2])
    expect(ratioOf(opened)).toEqual(ratioOf(earlier))
    expect(earlier.warnings).toEqual([])
  })

  // A ratio the source did not write in lowest terms is the number drawn over
  // the bracket, so six in the time of four stays six in the time of four.
  test('keeps the counts the source wrote', () => {
    const sextuplet = (duration: number, actual: number, notations: string) =>
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>${String(duration)}</duration><type>quarter</type>` +
      `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
      '<normal-notes>4</normal-notes></time-modification>' +
      `<notations>${notations}</notations></note>`
    const { content, warnings } = read(
      measure(
        sextuplet(
          4,
          12,
          '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo>' + '</ornaments>',
        ) +
          sextuplet(4, 12, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          sextuplet(8, 6, '').repeat(4) +
          sextuplet(8, 6, '<tuplet type="stop"/>'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(6)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(4)
    expect(warnings).toEqual([])
  })

  // With no <time-modification> the note itself says how long it lasts
  // against how it is written, and that reading counts the tremolo too.
  test('names the bracket it converts where the note states no ratio', () => {
    const bare = (duration: number, notations: string) =>
      '<note><pitch><step>C</step><octave>4</octave></pitch>' +
      `<duration>${String(duration)}</duration><type>quarter</type>` +
      `<notations>${notations}</notations></note>`
    const { content, warnings } = read(
      measure(
        bare(4, '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo></ornaments>') +
          bare(4, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          bare(8, '') +
          bare(8, '<tuplet type="stop"/>'),
      ),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings.map((w) => w.code)).toEqual(['missing:time-modification'])
    expect(warnings[0]?.message).toContain('takes half of that, so the bracket is converted as 2/3')
  })

  // A marker states the bracket's own ratio, which is the cumulative one with
  // the tremolo's half already out of it, so the two agree and it stands.
  test('keeps the ratio a marker states beside the tremolo', () => {
    const portions =
      '<tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>quarter</tuplet-type>' +
      '</tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number>' +
      '<tuplet-type>quarter</tuplet-type></tuplet-normal>'
    const { content, warnings } = read(
      measure(tremoloPair(`<tuplet type="start">${portions}</tuplet>`) + closing),
    )
    const tuplet = content?.[0]

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(warnings).toEqual([])
  })

  test('writes legal MNX for it', () => {
    const { warnings } = convertValid(measure(tremoloPair('<tuplet type="start"/>') + closing))

    expect(warnings).toEqual([])
  })
})

// A source that draws no bracket says the tuplet is there in the ratio alone,
// and that ratio counts the tremolo as well. The pair's own share has to come
// out of it before what is left can say whether a tuplet is there.
describe('a tuplet stated as a ratio with no bracket, opening on a tremolo', () => {
  // A triplet of quarters whose first quarter is a two-note tremolo, with no
  // <tuplet> anywhere. Each note of the pair is written as a quarter and
  // lasts a sixth of one.
  const rated = (duration: number, actual: number, notations = '') =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><type>quarter</type>` +
    `<time-modification><actual-notes>${String(actual)}</actual-notes>` +
    '<normal-notes>2</normal-notes></time-modification>' +
    (notations ? `<notations>${notations}</notations>` : '') +
    '</note>'
  const tremoloPair =
    rated(4, 6, '<ornaments><tremolo type="start">3</tremolo></ornaments>') +
    rated(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>')
  const triplet = tremoloPair + rated(8, 3) + rated(8, 3)

  test('reads the ratio the tremolo leaves as the tuplet', () => {
    const { content, warnings } = read(measure(triplet))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(tuplet?.kind === 'tuplet' && tuplet.inner.multiple).toBe(3)
    expect(tuplet?.kind === 'tuplet' && tuplet.outer.multiple).toBe(2)
    expect(inside.map((item) => item.kind)).toEqual(['multiNoteTremolo', 'event', 'event'])
    expect(warnings).toEqual([])
  })

  test('reads it as the same music with a bracket drawn around it is read', () => {
    const bracketed = read(
      measure(
        rated(
          4,
          6,
          '<tuplet type="start"/><ornaments><tremolo type="start">3</tremolo></ornaments>',
        ) +
          rated(4, 6, '<ornaments><tremolo type="stop">3</tremolo></ornaments>') +
          rated(8, 3) +
          rated(8, 3, '<tuplet type="stop"/>'),
      ),
    )
    const ratioOf = (result: ReturnType<typeof read>) => {
      const tuplet = result.content?.[0]
      return tuplet?.kind === 'tuplet' ? [tuplet.inner.multiple, tuplet.outer.multiple] : []
    }

    expect(ratioOf(read(measure(triplet)))).toEqual(ratioOf(bracketed))
  })

  // The run reaches over the pair wherever it stands: both notes state the
  // counts the run was opened with, once the pair's share comes out.
  test('keeps a run open around a tremolo standing inside it', () => {
    const { content, warnings } = read(measure(rated(8, 3) + tremoloPair + rated(8, 3)))
    const tuplet = content?.[0]
    const inside = tuplet?.kind === 'tuplet' ? tuplet.content : []

    expect(content).toHaveLength(1)
    expect(inside.map((item) => item.kind)).toEqual(['event', 'multiNoteTremolo', 'event'])
    expect(warnings).toEqual([])
  })

  // A two-note tremolo standing on its own carries the same 2:1 and is no
  // tuplet: taking the pair's share out leaves nothing for a tuplet to state.
  test('opens no tuplet around a tremolo the ratio only counts the pair of', () => {
    const { content, warnings } = read(
      measure(tremoloNote('C', 'start') + tremoloNote('E', 'stop')),
    )

    expect(content?.map((item) => item.kind)).toEqual(['multiNoteTremolo'])
    expect(warnings).toEqual([])
  })

  // Where the source states no value for the ratio to count, there is nothing
  // for a tuplet to be written in, and the pair is read as the pair it is.
  test('reads a pair stating no value to count as a plain tremolo', () => {
    const typeless =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const { content, warnings } = read(measure(typeless + tremoloNote('E', 'stop')))

    expect(content?.map((item) => item.kind)).toEqual(['multiNoteTremolo'])
    expect(warnings).toEqual([])
  })

  test('writes legal MNX for it', () => {
    const { warnings } = convertValid(measure(triplet))

    expect(warnings).toEqual([])
  })
})
