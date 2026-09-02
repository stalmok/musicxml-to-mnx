// MusicXML puts beams on the notes: each note says, for every beam level it
// carries, whether a beam begins, continues or ends there. MNX states them
// the other way round, as a tree over the measure: an outer beam listing its
// events, nested beams for the secondary levels, and a single-event beam with
// a direction for a hook. What the document then declares once, in its
// support block, is tested in tests/support-block.test.ts.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { buildBeams } from './beams.js'
import type { BeamedEvent } from './beams.js'

/**
 * `levels` reads as "level:marker", separated by semicolons because a marker
 * may itself hold a space, as "forward hook" does. The beam count defaults to
 * the deepest level the event names, which is what a well-formed note carries;
 * pass one to model a note whose value needs fewer beams than it marks.
 */
function event(id: string, levels: string, beamCount?: number): BeamedEvent {
  const markers = new Map<number, string>()
  let deepest = 0
  for (const part of levels.split(';').filter(Boolean)) {
    const [level, marker] = part.split(':')
    markers.set(Number(level), marker ?? '')
    deepest = Math.max(deepest, Number(level))
  }
  return { id, markers, beamCount: beamCount ?? deepest }
}

describe('a single beam', () => {
  // An event carrying no marker at this level is not in the run, and closes
  // it. Nothing said so: the beam could have run straight through the event
  // and joined what came after it to what came before.
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

  // A malformed source begins level 2 twice with no end between. The first note
  // is left alone at level 2, and dropping it would put a 16th in the level-1
  // beam with no level-2 beam of its own, which is internally inconsistent. It
  // becomes a forward hook instead, since a lone begin is a partial beam.
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

  // The same lone begin at level 2, but on a note whose value needs only one
  // beam: the level-2 marker is stray, so it is dropped and the note keeps just
  // its outer beam.
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

  test('drops a beam left with only one event under it', () => {
    // A beam over a single note is not a beam, it is a flag.
    expect(buildBeams([event('ev1', '1:begin'), event('ev2', '')])).toEqual([])
  })
})

// A level outside the eight a stem can carry cannot be drawn, so the marker
// is dropped. The marker still said something about the beam at its level,
// and the beam beside it is drawn as if it had never been written: a run
// whose end is dropped closes at the last marker before it.
describe('a beam marker at a level that does not exist', () => {
  function sixteenth(step: string, beams: string): string {
    return (
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration>` +
      `<type>16th</type>${beams}</note>`
    )
  }

  function read(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
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

    // The outer beam runs over all three; the inner one stops where the last
    // marker it kept left it, which is what the report is about.
    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2', 'ev3']])
    expect(beams[0]?.beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings.map((w) => w.message)).toEqual([
      'The "number" of a <beam> is "9", which is not one of the eight beam levels. ' +
        'The marker is dropped, and the beams beside it are drawn as if it had never ' +
        'been written.',
    ])
  })

  // The eighth level is the last one MNX draws, and the first is the first.
  // Both edges are stated, because a range asserted at one end only could
  // have the other move by one and nothing would notice.
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
    readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>256</divisions></attributes>' +
          `${deep('C', 'begin')}${deep('D', 'end')}</measure></part></score-partwise>`,
      ),
      warnings,
    )

    expect(warnings.list()).toEqual([])
  })

  // MusicXML's beam number defaults to 1, so a <beam> stating none is a
  // first-level marker. Every fixture elsewhere numbers its beams, so nothing
  // said that an unnumbered one beams anything at all.
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

  test('keeps a marker at the first level', () => {
    const { beams, warnings } = read(
      sixteenth('C', '<beam number="1">begin</beam>') +
        sixteenth('D', '<beam number="1">end</beam>'),
    )

    expect(beams.map((beam) => beam.events)).toEqual([['ev1', 'ev2']])
    expect(warnings).toEqual([])
  })
})

// Grace notes beam among themselves. Their markers are read as their own run,
// because a grace group sitting between two beamed notes would otherwise open
// a beam in the middle of theirs and leave the outer one with nothing to
// close it.
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
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
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

  // The case that makes the separate run necessary: read as one stream, the
  // grace group's begin would cut the outer beam in half.
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
