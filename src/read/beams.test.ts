// MusicXML puts beams on the notes: each note says, for every beam level it
// carries, whether a beam begins, continues or ends there. MNX states them
// the other way round, as a tree over the measure: an outer beam listing its
// events, nested beams for the secondary levels, and a single-event beam with
// a direction for a hook. The support block is tested in
// tests/support-block.test.ts.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { WarningCollector } from './collector.js'
import { buildBeams as buildReported, isBeamValue } from './beams.js'
import type { BeamedEvent, BeamMarker } from './beams.js'

const buildBeams = (events: readonly BeamedEvent[]) =>
  buildReported(events, new WarningCollector(), {})

/**
 * `levels` reads as "level:marker", separated by semicolons because a marker
 * may itself hold a space, as "forward hook" does. The beam count defaults to
 * the deepest level the event names, which is what a well-formed note carries;
 * pass one to model a note whose value needs fewer beams than it marks.
 */
function event(id: string, levels: string, beamCount?: number): BeamedEvent {
  const markers = new Map<number, BeamMarker>()
  let deepest = 0
  for (const part of levels.split(';').filter(Boolean)) {
    const [level, kind = ''] = part.split(':')
    if (!isBeamValue(kind)) throw new Error(`"${kind}" is not a beam marker`)
    markers.set(Number(level), {
      kind,
      element: { name: 'beam', attributes: {}, children: [], text: kind, line: 1 },
    })
    deepest = Math.max(deepest, Number(level))
  }
  return { id, markers, beamCount: beamCount ?? deepest, continuesFromBefore: false }
}

describe('a single beam', () => {
  test('closes a run at an event carrying no marker at that level', () => {
    const beams = buildBeams([
      event('ev1', '1:begin'),
      event('ev2', '1:continue'),
      event('ev3', ''),
      event('ev4', '1:end'),
    ])

    expect(beams).toEqual([{ events: ['ev1', 'ev2'], beams: [], direction: undefined }])
  })

  test('gathers the events it runs over', () => {
    const beams = buildBeams([
      event('ev1', '1:begin'),
      event('ev2', '1:continue'),
      event('ev3', '1:end'),
    ])

    expect(beams).toEqual([{ events: ['ev1', 'ev2', 'ev3'], beams: [], direction: undefined }])
  })

  test('keeps two beams in the same measure apart', () => {
    const beams = buildBeams([
      event('ev1', '1:begin'),
      event('ev2', '1:end'),
      event('ev3', '1:begin'),
      event('ev4', '1:end'),
    ])

    expect(beams.map((beam) => beam.events)).toEqual([
      ['ev1', 'ev2'],
      ['ev3', 'ev4'],
    ])
  })

  test('passes over events that carry no beam', () => {
    const beams = buildBeams([event('ev1', ''), event('ev2', '1:begin'), event('ev3', '1:end')])

    expect(beams).toEqual([{ events: ['ev2', 'ev3'], beams: [], direction: undefined }])
  })

  test('finds nothing to beam in a measure with no beams', () => {
    expect(buildBeams([event('ev1', ''), event('ev2', '')])).toEqual([])
  })
})

describe('secondary beams', () => {
  test('nests the second level inside the first', () => {
    const beams = buildBeams([
      event('ev1', '1:begin; 2:begin'),
      event('ev2', '1:continue; 2:end'),
      event('ev3', '1:continue; 2:begin'),
      event('ev4', '1:end; 2:end'),
    ])

    expect(beams).toEqual([
      {
        events: ['ev1', 'ev2', 'ev3', 'ev4'],
        direction: undefined,
        beams: [
          { events: ['ev1', 'ev2'], beams: [], direction: undefined },
          { events: ['ev3', 'ev4'], beams: [], direction: undefined },
        ],
      },
    ])
  })

  test('nests a third level inside the second', () => {
    const beams = buildBeams([
      event('ev1', '1:begin; 2:begin; 3:begin'),
      event('ev2', '1:continue; 2:continue; 3:end'),
      event('ev3', '1:end; 2:end'),
    ])
    const second = beams[0]?.beams[0]

    expect(second?.events).toEqual(['ev1', 'ev2', 'ev3'])
    expect(second?.beams[0]?.events).toEqual(['ev1', 'ev2'])
  })

  // A malformed source begins level 2 twice with no end between. Dropping the
  // first note's level-2 marker would put a 16th in the level-1 beam with no
  // level-2 beam of its own. A lone begin is a partial beam, so it becomes a
  // forward hook.
  test('draws a repeated begin as a forward hook on the first note', () => {
    const beams = buildBeams([
      event('ev1', '1:begin; 2:begin'),
      event('ev2', '1:continue; 2:begin'),
      event('ev3', '1:continue; 2:continue'),
      event('ev4', '1:end; 2:end'),
    ])

    expect(beams[0]?.beams).toEqual([
      { events: ['ev1'], beams: [], direction: 'right' },
      { events: ['ev2', 'ev3', 'ev4'], beams: [], direction: undefined },
    ])
  })

  // The same lone begin at level 2, on a note whose value needs only one
  // beam. The level-2 marker is stray, so it is dropped.
  test('drops a stray inner marker a note does not need', () => {
    const beams = buildBeams([
      event('ev1', '1:begin; 2:begin', 1),
      event('ev2', '1:continue; 2:begin', 1),
      event('ev3', '1:continue', 1),
      event('ev4', '1:end', 1),
    ])

    expect(beams[0]?.beams).toEqual([])
    expect(beams[0]?.events).toEqual(['ev1', 'ev2', 'ev3', 'ev4'])
  })
})

describe('hooks', () => {
  test('reads a forward hook as a beam of one pointing right', () => {
    const beams = buildBeams([event('ev1', '1:begin; 2:forward hook'), event('ev2', '1:end')])

    expect(beams[0]?.beams).toEqual([{ events: ['ev1'], beams: [], direction: 'right' }])
  })

  test('reads a backward hook as a beam of one pointing left', () => {
    const beams = buildBeams([event('ev1', '1:begin'), event('ev2', '1:end; 2:backward hook')])

    expect(beams[0]?.beams).toEqual([{ events: ['ev2'], beams: [], direction: 'left' }])
  })

  // A 32nd note beside a double-dotted eighth carries hooks at level 2 and
  // level 3 at once: one for its 16th beam, one for its 32nd beam. The
  // deeper hook nests inside the shallower one.
  test('nests a deeper hook inside the hook above it', () => {
    const beams = buildBeams([
      event('ev1', '1:begin'),
      event('ev2', '1:continue'),
      event('ev3', '1:end; 2:backward hook; 3:backward hook'),
    ])

    expect(beams[0]?.beams).toEqual([
      {
        events: ['ev3'],
        beams: [{ events: ['ev3'], beams: [], direction: 'left' }],
        direction: 'left',
      },
    ])
  })

  test('keeps hooks in the order they appear alongside a nested beam', () => {
    const beams = buildBeams([
      event('ev1', '1:begin; 2:forward hook'),
      event('ev2', '1:continue'),
      event('ev3', '1:end; 2:backward hook'),
    ])

    expect(beams[0]?.beams.map((beam) => [beam.events[0], beam.direction])).toEqual([
      ['ev1', 'right'],
      ['ev3', 'left'],
    ])
  })
})

describe('beams the measure does not finish', () => {
  test('keeps a beam that never ends, so the notes under it are not lost', () => {
    const beams = buildBeams([event('ev1', '1:begin'), event('ev2', '1:continue')])

    expect(beams).toEqual([{ events: ['ev1', 'ev2'], beams: [], direction: undefined }])
  })

  test('ignores an end with no beginning rather than inventing a beam', () => {
    expect(buildBeams([event('ev1', '1:end')])).toEqual([])
  })

  test('ignores a continue with no beginning, so the end after it joins nothing', () => {
    expect(buildBeams([event('ev1', '1:continue'), event('ev2', '1:end')])).toEqual([])
  })

  test('closes at its end, so a later continue does not extend it', () => {
    const beams = buildBeams([
      event('ev1', '1:begin'),
      event('ev2', '1:end'),
      event('ev3', '1:continue'),
      event('ev4', '1:end'),
    ])

    expect(beams).toEqual([{ events: ['ev1', 'ev2'], beams: [], direction: undefined }])
  })

  test('drops a beam left with only one event under it', () => {
    // A beam over a single note is not a beam, it is a flag.
    expect(buildBeams([event('ev1', '1:begin'), event('ev2', '')])).toEqual([])
  })
})

// A level outside the eight a stem can carry cannot be drawn, so the marker
// is dropped. A run whose end is dropped closes at the last marker before it.
// A marker whose text MusicXML does not define stops the beam at its level
// before the note.
describe('a beam marker MusicXML does not define', () => {
  function sixteenth(step: string, beams: string): string {
    return (
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${beams}</note>`
    )
  }

  function read(body: string) {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      warnings,
    )
    return { beams: score.parts[0]?.measures[0]?.beams ?? [], warnings: warnings.list() }
  }

  test('draws the run short where the dropped marker ended it', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam><beam number="2">begin</beam>') +
        sixteenth('D', '<beam number="1">continue</beam><beam number="2">continue</beam>') +
        sixteenth('E', '<beam number="1">end</beam><beam number="9">end</beam>'),
    )

    // The outer beam runs over all three. The inner one stops at the last
    // marker it kept.
    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2', 'ev3']])
    expect(beams[0]?.beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings.map((w) => w.message)).toEqual([
      'The "number" of a <beam> is "9", which is not one of the eight beam levels. ' +
        'The marker is dropped, and the beams beside it are drawn as if it had never ' +
        'been written.',
    ])
  })

  // MNX draws levels 1 to 8.
  test('keeps a marker at the eighth level, which is the last one there is', () => {
    const deep = (step: string, marker: string) => {
      const levels = [1, 2, 3, 4, 5, 6, 7, 8]
        .map((level) => `<beam number="${String(level)}">${marker}</beam>`)
        .join('')
      return (
        `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
        `<type>1024th</type>${levels}</note>`
      )
    }
    const warnings = new WarningCollector()
    readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>256</divisions></attributes>' +
        `${deep('C', 'begin')}${deep('D', 'end')}</measure></part></score-partwise>`,
      warnings,
    )

    expect(warnings.list()).toEqual([])
  })

  // MusicXML's beam number defaults to 1.
  test('reads a beam stating no number as the first level', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam>begin</beam>') + sixteenth('D', '<beam>end</beam>'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings).toEqual([])
  })

  test('reports a marker below the first level', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam><beam number="0">begin</beam>') +
        sixteenth('D', '<beam number="1">end</beam>'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings.map((w) => w.element)).toEqual(['beam'])
    expect(warnings[0]?.message).toContain('not one of the eight beam levels')
  })

  // MusicXML's beam level is a positive integer, which may carry a plus sign.
  test('reads a level written with a plus sign', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam number="+1">begin</beam>') +
        sixteenth('D', '<beam number="1">end</beam>'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings).toEqual([])
  })

  test('keeps a marker at the first level', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam>') +
        sixteenth('D', '<beam number="1">end</beam>'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings).toEqual([])
  })

  // MusicXML's beam-value is begin, continue, end, forward hook and backward
  // hook, spelled as written.
  test.each(['middle', 'Begin', 'forward-hook', ''])(
    'reports a marker of "%s", and stops the beam at its level before the note',
    (marker) => {
      const { beams, warnings } = read(
        sixteenth('C', '<beam number="1">begin</beam><beam number="2">begin</beam>') +
          sixteenth('D', `<beam number="1">continue</beam><beam number="2">${marker}</beam>`) +
          sixteenth('E', '<beam number="1">end</beam><beam number="2">end</beam>'),
      )

      // The inner run leaves the first note a partial beam, and the end
      // after it joins nothing.
      expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2', 'ev3']])
      expect(beams[0]?.beams).toEqual([{ events: ['ev1'], beams: [], direction: 'right' }])
      expect(warnings.map((w) => [w.code, w.element, w.message])).toEqual([
        [
          'unresolved:element-value',
          'beam',
          `A <beam> of "${marker}" is not one MusicXML defines, and the beam at its level ` +
            'stops before this note.',
        ],
      ])
    },
  )

  test('does not draw a primary beam over a note whose only marker it cannot read', () => {
    const { beams } = read(
      sixteenth('C', '<beam number="1">begin</beam>') +
        sixteenth('D', '<beam number="1">middle</beam>') +
        sixteenth('E', '<beam number="1">end</beam>'),
    )

    expect(beams).toEqual([])
  })

  test.each([
    ['an undefined level', '<beam number="9" fan="rit">end</beam>', 'unresolved:attribute-value'],
    ['undefined text', '<beam number="1" fan="rit">middle</beam>', 'unresolved:element-value'],
  ])('says nothing of the fan of a marker with %s', (_case, marker, code) => {
    const { warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam>') + sixteenth('D', marker),
    )

    expect(warnings.map((w) => w.code)).toEqual([code])
  })

  test('reports only the level of a marker whose level and text are both undefined', () => {
    const { warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam>') +
        sixteenth('D', '<beam number="1">end</beam><beam number="9">middle</beam>'),
    )

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([
      ['unresolved:attribute-value', 'number'],
    ])
  })
})

// Grace notes beam among themselves, so their markers are read as their own
// run. Otherwise a grace group between two beamed notes would open a beam in
// the middle of theirs and leave the outer one with nothing to close it.
describe('beaming grace notes', () => {
  function graceNote(step: string, marker: string): string {
    return (
      `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch>` +
      `<type>16th</type><beam number="1">${marker}</beam></note>`
    )
  }

  function mainNote(step: string, marker: string): string {
    return (
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration>` +
      `<type>eighth</type><beam number="1">${marker}</beam></note>`
    )
  }

  function beamsOf(body: string) {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      warnings,
    )
    return { beams: score.parts[0]?.measures[0]?.beams ?? [], warnings: warnings.list() }
  }

  test('beams a grace group of its own', () => {
    const { beams, warnings } = beamsOf(
      graceNote('B', 'begin') +
        graceNote('C', 'end') +
        mainNote('D', 'begin') +
        mainNote('E', 'end'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([
      ['ev3', 'ev4'],
      ['ev1', 'ev2'],
    ])
    expect(warnings).toEqual([])
  })

  // Read as one stream, the grace group's begin would cut the outer beam in
  // half.
  test('leaves a beam whole when a grace group interrupts it', () => {
    const { beams } = beamsOf(
      mainNote('D', 'begin') +
        graceNote('B', 'begin') +
        graceNote('C', 'end') +
        mainNote('E', 'end'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([
      ['ev1', 'ev4'],
      ['ev2', 'ev3'],
    ])
  })
})

describe('a beam crossing the barline', () => {
  const QUARTER =
    '<note><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'

  function eighth(step: string, marker?: string): string {
    return (
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration>` +
      `<type>eighth</type>${marker ? `<beam number="1">${marker}</beam>` : ''}</note>`
    )
  }

  // Each measure on its own line, so a warning's line names the measure.
  function readMeasures(...bodies: string[]) {
    const warnings = new WarningCollector()
    const measures = bodies
      .map(
        (body, index) =>
          `<measure number="${String(index + 1)}">` +
          (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
          `${body}</measure>`,
      )
      .join('\n')
    const score = readValid(
      `<score-partwise><part id="P1">\n${measures}\n</part></score-partwise>`,
      warnings,
    )
    const read = score.parts[0]?.measures ?? []
    return {
      beams: read.map((measure) => measure.beams.map((b) => b.events)),
      trees: read.map((measure) => measure.beams),
      warnings: warnings.list(),
    }
  }

  const CROSSES =
    'A beam crosses the barline into this measure, which is not converted yet. It is ' +
    'drawn as one beam each side of the barline, and a side holding one note is not beamed.'

  test('reports a beam over two single notes, and beams neither', () => {
    const { beams, warnings } = readMeasures(eighth('C', 'begin'), eighth('D', 'end'))

    expect(beams).toEqual([[], []])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported:element',
        element: 'beam',
        message: CROSSES,
        context: expect.objectContaining({ measure: 2, line: 3 }),
      }),
    ])
  })

  test('beams the notes on each side of the barline on their own', () => {
    const { beams, warnings } = readMeasures(
      eighth('C', 'begin') + eighth('D', 'continue'),
      eighth('E', 'continue') + eighth('F', 'continue') + eighth('G', 'end') + eighth('A'),
    )

    expect(beams).toEqual([[['ev1', 'ev2']], [['ev3', 'ev4', 'ev5']]])
    expect(warnings.map((w) => w.message)).toEqual([CROSSES])
  })

  // A source may leave the barline to close a beam, and then nothing is lost.
  test('keeps a beam the measure never ends, and says nothing', () => {
    const { beams, warnings } = readMeasures(
      eighth('C', 'begin') + eighth('D', 'continue'),
      eighth('E', 'begin') + eighth('F', 'end'),
    )

    expect(beams).toEqual([[['ev1', 'ev2']], [['ev3', 'ev4']]])
    expect(warnings).toEqual([])
  })

  // Only the note opening the measure can carry on a beam from before it.
  test('says nothing of an end with no begin later in the measure', () => {
    const { beams, warnings } = readMeasures(
      eighth('A', 'begin'),
      QUARTER + eighth('C', 'end') + eighth('D', 'end'),
    )

    expect(beams).toEqual([[], []])
    expect(warnings).toEqual([])
  })

  // The source's markers say nothing crossed: the beam before was closed.
  test('says nothing of an end opening the measure after a closed beam', () => {
    const { beams, warnings } = readMeasures(
      eighth('A', 'begin') + eighth('B', 'end') + QUARTER,
      eighth('C', 'end') + eighth('D', 'end'),
    )

    expect(beams).toEqual([[['ev1', 'ev2']], []])
    expect(warnings).toEqual([])
  })

  test('says nothing of an end opening the measure where no beam came before', () => {
    const { beams, warnings } = readMeasures(QUARTER, eighth('C', 'end') + eighth('D', 'end'))

    expect(beams).toEqual([[], []])
    expect(warnings).toEqual([])
  })

  // Beamed at an inner level only, the last note is outside the primary beam.
  test('says nothing where the last note before the barline has no primary beam', () => {
    const inner =
      '<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration>' +
      '<type>16th</type><beam number="2">backward hook</beam></note>'
    const { warnings } = readMeasures(eighth('A', 'begin') + inner, eighth('C', 'end'))

    expect(warnings).toEqual([])
  })

  test('reports a beam carried on past a beamed grace group', () => {
    const grace = (step: string, marker: string) =>
      `<note><grace/><pitch><step>${step}</step><octave>5</octave></pitch>` +
      `<type>16th</type><beam number="1">${marker}</beam></note>`
    const { beams, warnings } = readMeasures(
      eighth('A', 'begin') + eighth('B', 'continue'),
      grace('D', 'begin') + grace('E', 'end') + eighth('C', 'continue') + eighth('F', 'end'),
    )

    expect(beams?.[1]).toEqual([
      ['ev5', 'ev6'],
      ['ev3', 'ev4'],
    ])
    expect(warnings.map((w) => w.message)).toEqual([CROSSES])
  })

  test('says nothing where an unbeamed note follows the beam before the barline', () => {
    const { warnings } = readMeasures(
      eighth('A', 'begin') + eighth('B', 'continue') + QUARTER,
      eighth('C', 'end'),
    )

    expect(warnings).toEqual([])
  })

  // MusicXML reads a note naming no staff as on the first.
  test('says nothing of a beam the same unnamed voice left open on another staff', () => {
    const on = (staff: string, note: string) =>
      note.replace('</note>', `<staff>${staff}</staff></note>`)
    const { warnings } = readMeasures(
      '<attributes><staves>2</staves></attributes>' + on('1', eighth('A', 'begin')),
      on('2', eighth('C', 'end')),
    )

    expect(warnings).toEqual([])
  })

  test('reports a beam a named voice carries over the barline onto another staff', () => {
    const on = (staff: string, note: string) =>
      note
        .replace('<type>', '<voice>1</voice><type>')
        .replace('</note>', `<staff>${staff}</staff></note>`)
    const { warnings } = readMeasures(
      '<attributes><staves>2</staves></attributes>' + on('2', eighth('A', 'begin')),
      on('1', eighth('C', 'end')),
    )

    expect(warnings.map((w) => w.message)).toEqual([CROSSES])
  })

  test('reports a beam crossing once where the voice runs in two lines', () => {
    const backup = '<backup><duration>4</duration></backup>'
    const { beams, warnings } = readMeasures(
      eighth('A', 'begin') + eighth('B', 'continue'),
      eighth('C', 'continue') +
        eighth('D', 'end') +
        backup +
        eighth('E', 'continue') +
        eighth('F', 'end'),
    )

    expect(beams?.[1]).toEqual([['ev3', 'ev4']])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:voice', 'unsupported:element'])
    expect(warnings[1]?.message).toBe(CROSSES)
  })

  // The primary beam begins here, so a stray inner continue carries nothing on.
  test('carries no inner beam on where the primary beam begins at the barline', () => {
    const sixteenth = (step: string, inner: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${inner}</note>`
    const { trees, warnings } = readMeasures(
      sixteenth('B', '<beam number="1">begin</beam><beam number="2">begin</beam>'),
      sixteenth('C', '<beam number="1">begin</beam><beam number="2">continue</beam>') +
        sixteenth('D', '<beam number="1">end</beam><beam number="2">end</beam>'),
    )

    expect(trees[1]).toEqual([{ events: ['ev2', 'ev3'], beams: [], direction: undefined }])
    expect(warnings).toEqual([])
  })

  // A hook stands alone, so the inner beam on it carries nothing on either.
  test('carries no inner beam on through a hook at the barline', () => {
    const sixteenth = (step: string, inner: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${inner}</note>`
    const { trees } = readMeasures(
      sixteenth('B', '<beam number="1">begin</beam><beam number="2">begin</beam>'),
      sixteenth('C', '<beam number="1">backward hook</beam><beam number="2">end</beam>'),
    )

    expect(trees[1]).toEqual([{ events: ['ev2'], beams: [], direction: 'left' }])
  })

  test('says nothing of a beam another voice left open', () => {
    const voiced = (voice: string, note: string) =>
      note.replace('<type>', `<voice>${voice}</voice><type>`)
    const { beams, warnings } = readMeasures(
      voiced('1', eighth('A', 'begin')),
      voiced('2', eighth('C', 'continue')) + voiced('2', eighth('D', 'end')),
    )

    expect(beams).toEqual([[], []])
    expect(warnings).toEqual([])
  })

  // A grace group beams within itself, so its beams never cross the barline.
  test('says nothing of a grace note opening the measure with an end', () => {
    const grace =
      '<note><grace/><pitch><step>B</step><octave>4</octave></pitch>' +
      '<type>16th</type><beam number="1">end</beam></note>'
    const { warnings } = readMeasures(eighth('A', 'begin'), grace + eighth('C'))

    expect(warnings).toEqual([])
  })

  test('draws an inner beam from the measure before as a partial beam to the left', () => {
    const sixteenth = (step: string, inner: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${inner}</note>`
    const { trees, warnings } = readMeasures(
      sixteenth('B', '<beam number="1">begin</beam><beam number="2">begin</beam>'),
      sixteenth('C', '<beam number="1">continue</beam><beam number="2">end</beam>') +
        sixteenth('D', '<beam number="1">end</beam>'),
    )

    expect(trees).toEqual([
      [],
      [
        {
          events: ['ev2', 'ev3'],
          beams: [{ events: ['ev2'], beams: [], direction: 'left' }],
          direction: undefined,
        },
      ],
    ])
    expect(warnings.map((w) => w.message)).toEqual([CROSSES])
  })

  test('reports nothing for an inner beam the primary one closes', () => {
    const sixteenth = (step: string, inner: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${inner}</note>`
    const { beams, warnings } = readMeasures(
      sixteenth('C', '<beam number="1">begin</beam><beam number="2">end</beam>') +
        sixteenth('D', '<beam number="1">end</beam><beam number="2">begin</beam>'),
    )

    expect(beams).toEqual([[['ev1', 'ev2']]])
    expect(warnings).toEqual([])
  })
})
