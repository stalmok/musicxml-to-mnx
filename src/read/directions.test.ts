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
    expect(warnings[0]?.message).toContain('outside its measure')
  })

  // An offset is counted in divisions. Where a file never says how many make
  // a quarter note, the customary one per quarter is assumed and reported.
  test('assumes one division per quarter for an offset before any <divisions>', () => {
    const warnings = new WarningCollector()
    readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `${dynamic('<offset>2</offset>')}</measure></part></score-partwise>`,
      ),
      warnings,
    )

    expect(warnings.list().map((w) => w.code)).toContain('missing:divisions')
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

  // The two are the same mark written twice: the direction draws it, the
  // <sound> beside it repeats it for playback.
  test('passes over one at the same point as a tempo a <direction> already gave', () => {
    const { tempos: found } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type></direction>' +
        '<sound tempo="90"/>' +
        quarter,
    )

    expect(found.map((t) => t.bpm)).toEqual([120])
  })

  test('takes one that falls later in the measure than the tempo already given', () => {
    const { tempos: found } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type></direction>' +
        quarter +
        '<sound tempo="90"/>',
    )

    expect(found.map((t) => t.bpm)).toEqual([120, 90])
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

// A hairpin grows or fades from here to somewhere later, often several
// measures away. MusicXML marks both ends and numbers them so they can be
// matched, exactly as it does a slur; MNX states the pair once, on the end
// where it begins, pointing at the measure where it stops.
describe('hairpins', () => {
  const NOTE =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'

  const wedge = (type: string, number = '1') =>
    `<direction><direction-type><wedge type="${type}" number="${number}"/></direction-type></direction>`

  function readMeasures(...bodies: string[]) {
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
      dynamics: (score.parts[0]?.measures ?? []).map((m) => m.dynamics),
      warnings: warnings.list(),
    }
  }

  test('states a crescendo as a wedge opening out, with where it stops', () => {
    const { dynamics, warnings } = readMeasures(wedge('crescendo') + NOTE, NOTE + wedge('stop'))

    expect(dynamics[0]?.[0]).toEqual({
      position: { num: 0, den: 1 },
      value: undefined,
      wedge: 'increasing',
      end: { measure: 1, position: { num: 1, den: 4 } },
      staff: undefined,
    })
    expect(dynamics[1]).toEqual([])
    expect(warnings).toEqual([])
  })

  test('states a diminuendo as a wedge closing', () => {
    const { dynamics } = readMeasures(wedge('diminuendo') + NOTE + wedge('stop'))

    expect(dynamics[0]?.[0]?.wedge).toBe('decreasing')
    expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
  })

  // Several may be open at once, so each number holds a stack and a stop
  // closes the most recently opened, exactly as a slur does.
  test('matches each hairpin to the stop that carries its number', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo', '1') + wedge('diminuendo', '2') + NOTE,
      NOTE + wedge('stop', '2') + wedge('stop', '1'),
    )

    expect(dynamics[0]?.map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(warnings).toEqual([])
  })

  // MNX allows a gradual mark with no end, and saying a hairpin starts here
  // says more than dropping it would. What is lost is how far it runs.
  test('keeps a hairpin nothing closes, and reports how far it runs is lost', () => {
    const { dynamics, warnings } = readMeasures(wedge('crescendo') + NOTE)

    expect(dynamics[0]?.[0]?.wedge).toBe('increasing')
    expect(dynamics[0]?.[0]?.end).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('nothing ends it')
  })

  test('reports a stop where no hairpin had started', () => {
    const { dynamics, warnings } = readMeasures(NOTE + wedge('stop'))

    expect(dynamics[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('none had started')
  })

  // "continue" marks a point partway along one, which MNX has no need of,
  // since it states only where a hairpin begins and ends.
  test('says nothing about a point partway along one', () => {
    const { warnings } = readMeasures(
      wedge('crescendo') + NOTE,
      wedge('continue') + NOTE + wedge('stop'),
    )

    expect(warnings).toEqual([])
  })

  test('reports a wedge of a type it does not know', () => {
    const { warnings } = readMeasures(wedge('wibble') + NOTE)

    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('not converted yet')
  })

  // MusicXML's document order is not time order: a measure holding two voices
  // is written as one pass per voice with a <backup> between them, so a stop
  // belonging to the first voice is written before a start belonging to the
  // second. Pairing in document order made a hairpin out of two ends that had
  // nothing to do with each other.
  test('pairs the ends the music has together, not the ones written together', () => {
    const voiceOne =
      '<note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>quarter</type></note>'
    const { dynamics, warnings } = readMeasures(
      // Voice 1 fills the measure and its hairpin stops at the halfway point.
      voiceOne +
        voiceOne +
        wedge('stop') +
        '<backup><duration>8</duration></backup>' +
        // Voice 2, written afterwards, opens that hairpin at the start.
        wedge('crescendo') +
        `<note><voice>2</voice><pitch><step>E</step><octave>4</octave></pitch>` +
        `<duration>8</duration><type>half</type></note>`,
    )

    expect(dynamics[0]?.map((d) => [d.wedge, d.position, d.end])).toEqual([
      ['increasing', { num: 0, den: 1 }, { measure: 0, position: { num: 1, den: 2 } }],
    ])
    expect(warnings).toEqual([])
  })

  test('closes a hairpin that ends exactly where the next one begins', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo') + NOTE + wedge('stop') + wedge('diminuendo') + NOTE + wedge('stop'),
    )

    expect(dynamics[0]?.map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(dynamics[0]?.[1]?.end).toEqual({ measure: 0, position: { num: 1, den: 2 } })
    expect(warnings).toEqual([])
  })

  test('reports a wedge that states no type at all', () => {
    const { warnings } = readMeasures(
      '<direction><direction-type><wedge number="1"/></direction-type></direction>' + NOTE,
    )

    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('of type ""')
  })

  test('keeps the staff a hairpin belongs under', () => {
    const { dynamics } = readMeasures(
      '<attributes><staves>2</staves></attributes>' +
        '<direction><direction-type><wedge type="crescendo"/></direction-type>' +
        '<staff>2</staff></direction>' +
        NOTE +
        wedge('stop'),
    )

    expect(dynamics[0]?.[0]?.staff).toBe(2)
  })
})
