// A <direction> sits between the notes, at wherever the cursor has reached. A
// dynamic goes on the part's measure at that position; a metronome mark goes
// on the score's measure, since tempo is the whole score's. What MNX cannot
// state, like a word or a pedal, is reported.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

function note(step: string, quarters = 1): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(quarters * 4)}</duration><type>quarter</type></note>`
  )
}

function direction(body: string): string {
  return `<direction><direction-type>${body}</direction-type></direction>`
}

function inMeasure(body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions></attributes>' +
    `${body}</measure></part></score-partwise>`
  )
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  return {
    measure: score.parts[0]?.measures[0],
    global: score.globalMeasures[0],
    warnings: warnings.list(),
  }
}

describe('dynamics', () => {
  test('places a dynamic on the measure at the cursor', () => {
    const { measure } = read(inMeasure(direction('<dynamics><f/></dynamics>') + note('C')))

    expect(measure?.dynamics).toEqual([{ position: { num: 0, den: 1 }, value: 'f' }])
  })

  test('places a dynamic partway through the measure', () => {
    const { measure } = read(
      inMeasure(note('C') + direction('<dynamics><p/></dynamics>') + note('D')),
    )

    expect(measure?.dynamics[0]?.position).toEqual({ num: 1, den: 4 })
  })

  test.each(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'])('reads %s', (value) => {
    const { measure } = read(inMeasure(direction(`<dynamics><${value}/></dynamics>`) + note('C')))

    expect(measure?.dynamics[0]?.value).toBe(value)
  })

  // MNX's dynamic values stop at the plain ones. A sforzando or an
  // "other-dynamics" text has nowhere to go, so it is reported.
  test('reports a dynamic MNX has no value for', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><sf/></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.message)).toContain('A dynamic of "sf" is not converted yet.')
  })
})

describe('tempo', () => {
  test('places a metronome mark on the score measure', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 120 },
    ])
  })

  test('reads a dotted beat unit', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><beat-unit-dot/>' +
            '<per-minute>80</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.value).toEqual({ base: 'quarter', dots: 1 })
  })

  test('reports a metronome stated as one note value equalling another', () => {
    const { warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><beat-unit>eighth</beat-unit></metronome>',
        ) + note('C'),
      ),
    )

    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tempo')
  })

  test('rejects a metronome whose beat unit is not a note value', () => {
    let thrown = ''
    try {
      read(
        inMeasure(
          direction(
            '<metronome><beat-unit>triangle</beat-unit><per-minute>90</per-minute></metronome>',
          ) + note('C'),
        ),
      )
    } catch (e) {
      thrown = e instanceof Error ? e.message : ''
    }

    expect(thrown).toContain('is not a note value')
  })

  test('rejects a per-minute that is not a number', () => {
    let thrown = ''
    try {
      read(
        inMeasure(
          direction(
            '<metronome><beat-unit>quarter</beat-unit><per-minute>fast</per-minute></metronome>',
          ) + note('C'),
        ),
      )
    } catch (e) {
      thrown = e instanceof Error ? e.message : ''
    }

    expect(thrown).toContain('beats per minute')
  })

  test('rounds a fractional per-minute to whole beats', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>half</beat-unit><per-minute>63.5</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.bpm).toBe(64)
  })
})

describe('directions MNX cannot state', () => {
  test('reports a word', () => {
    const { warnings } = read(inMeasure(direction('<words>dolce</words>') + note('C')))

    expect(warnings.map((w) => w.message)).toContain('A <words> direction is not converted yet.')
  })

  test('reports a pedal mark', () => {
    const { warnings } = read(inMeasure(direction('<pedal type="start"/>') + note('C')))

    // MNX has no pedalling of any kind, so this one can never be converted.
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:element')
    expect(warnings.map((w) => w.message)).toContain(
      'A <pedal> direction cannot be expressed in MNX.',
    )
  })

  test('says nothing about a direction it fully converts', () => {
    const { warnings } = read(inMeasure(direction('<dynamics><mf/></dynamics>') + note('C')))

    expect(warnings).toEqual([])
  })
})

// A dynamic sits under a particular hand of a piano part, and MNX states the
// staff on the mark itself. A tempo is the whole score's, so it has no use
// for one.
describe('which staff a direction belongs under', () => {
  const twoStaves = '<attributes><divisions>4</divisions><staves>2</staves></attributes>'
  const noteOn = (staff: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>quarter</type><staff>${staff}</staff></note>`

  function dynamicsOf(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        `<score-partwise><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return { dynamics: score.parts[0]?.measures[0]?.dynamics ?? [], warnings: warnings.list() }
  }

  test('carries the staff a dynamic names', () => {
    const { dynamics, warnings } = dynamicsOf(
      twoStaves +
        noteOn('1') +
        '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
        '<staff>2</staff></direction>',
    )

    expect(dynamics.map((d) => d.staff)).toEqual([2])
    expect(warnings).toEqual([])
  })

  test('leaves it unset where the part has only one staff to name', () => {
    const { dynamics } = dynamicsOf(
      '<attributes><divisions>4</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
        '<type>quarter</type></note>' +
        '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
        '<staff>1</staff></direction>',
    )

    expect(dynamics.map((d) => d.staff)).toEqual([undefined])
  })

  test('rejects a staff the part does not have', () => {
    expect(() =>
      dynamicsOf(
        twoStaves +
          noteOn('1') +
          '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
          '<staff>3</staff></direction>',
      ),
    ).toThrow('outside the range 1 to 2')
  })
})
