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

// A direction sits where the cursor has reached, and <offset> shifts it from
// there, in divisions. It is routinely negative: a mark written after the
// note it belongs under is pulled back on to it.
describe('an offset moving a direction', () => {
  function at(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return {
      positions: (score.parts[0]?.measures[0]?.dynamics ?? []).map((d) => d.position),
      warnings: warnings.list(),
    }
  }

  const quarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'
  const dynamic = (body: string) =>
    `<direction><direction-type><dynamics><p/></dynamics></direction-type>${body}</direction>`

  test('moves the mark forward by that many divisions', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>2</offset>'))

    // One quarter in, plus two of four divisions, is three eighths.
    expect(positions).toEqual([{ num: 3, den: 8 }])
    expect(warnings).toEqual([])
  })

  test('pulls the mark back where the offset is negative', () => {
    const { positions, warnings } = at(quarter + quarter + dynamic('<offset>-4</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings).toEqual([])
  })

  // MNX counts a position from the start of its measure, so there is nowhere
  // to put a mark an offset drags behind the barline.
  test('leaves the mark where it was where the offset reaches behind the barline', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>-8</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.element)).toEqual(['offset'])
    expect(warnings[0]?.message).toContain('before the start of the measure')
  })

  // An offset is counted in divisions, so it cannot be read before something
  // has said how long one is. readDuration refuses the same way.
  test('rejects an offset stated before any <divisions>', () => {
    const warnings = new WarningCollector()

    expect(() =>
      readScore(
        parseXmlRoot(
          '<score-partwise><part id="P1"><measure number="1">' +
            `${dynamic('<offset>2</offset>')}</measure></part></score-partwise>`,
        ),
        warnings,
      ),
    ).toThrow('before any <divisions>')
  })

  // MusicXML allows a fractional offset. Rounding one would put the mark
  // somewhere the source did not.
  test('leaves the mark where it was where the offset is not a whole number', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>2.5</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.element)).toEqual(['offset'])
    expect(warnings[0]?.message).toContain('not a whole number')
  })
})

// <sound> is a playback element. The only thing in it MNX has anywhere for is
// the tempo, which MusicXML always counts in quarter notes per minute.
describe('the tempo a <sound> states', () => {
  function tempos(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return { tempos: score.globalMeasures[0]?.tempos ?? [], warnings: warnings.list() }
  }

  const quarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'

  test('reads it as that many quarter notes per minute', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="120"/></direction>' + quarter,
    )

    expect(found).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 120 },
    ])
    expect(warnings).toEqual([])
  })

  test('reads one written straight into the measure', () => {
    const { tempos: found, warnings } = tempos(`<sound tempo="88"/>${quarter}`)

    expect(found.map((t) => t.bpm)).toEqual([88])
    expect(warnings).toEqual([])
  })

  // The two say the same thing, and the metronome is the one that is drawn.
  test('passes over one that only restates a <metronome> beside it', () => {
    const { tempos: found } = tempos(
      '<direction><direction-type><metronome><beat-unit>half</beat-unit>' +
        '<per-minute>60</per-minute></metronome></direction-type>' +
        '<sound tempo="120"/></direction>' +
        quarter,
    )

    expect(found).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'half', dots: 0 }, bpm: 60 },
    ])
  })

  test('reports the playback it carries besides the tempo', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="100" dynamics="71"/></direction>' + quarter,
    )

    expect(found.map((t) => t.bpm)).toEqual([100])
    expect(warnings.map((w) => w.message)).toEqual([
      'The "dynamics" of a <sound> is not converted yet.',
    ])
  })

  // Playback junk is not worth refusing a whole document over.
  test('reports rather than refuses a tempo that is not a number', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="fast"/></direction>' + quarter,
    )

    expect(found).toEqual([])
    expect(warnings[0]?.message).toContain('which is not a tempo')
  })
})
