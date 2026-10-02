// A percussion part writes notes with no pitch: a height on the staff and the
// instrument struck at it. MNX names each instrument once, on the part's kit,
// and every note of the part names the component it strikes.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'

const DRUM_KIT =
  '<score-instrument id="P1-I39"><instrument-name>Acoustic Snare</instrument-name>' +
  '</score-instrument>' +
  '<score-instrument id="P1-I43"><instrument-name>Closed Hi-Hat</instrument-name>' +
  '</score-instrument>' +
  '<midi-instrument id="P1-I39"><midi-unpitched>39</midi-unpitched></midi-instrument>' +
  '<midi-instrument id="P1-I43"><midi-unpitched>43</midi-unpitched></midi-instrument>'

const PERCUSSION_CLEF =
  '<attributes><divisions>1</divisions><clef><sign>percussion</sign><line>2</line></clef>' +
  '</attributes>'

/** An unpitched note at a height, struck on an instrument where one is named. */
function struck(step: string, octave: string, instrument?: string, extra = ''): string {
  return (
    `<note><unpitched><display-step>${step}</display-step>` +
    `<display-octave>${octave}</display-octave></unpitched><duration>1</duration>` +
    `<type>quarter</type>${instrument ? `<instrument id="${instrument}"/>` : ''}${extra}</note>`
  )
}

function source(body: string, instruments = '', attributes = PERCUSSION_CLEF): string {
  return (
    '<score-partwise><part-list><score-part id="P1"><part-name>Drums</part-name>' +
    `${instruments}</score-part></part-list>` +
    `<part id="P1"><measure number="1">${attributes}${body}</measure></part>` +
    '</score-partwise>'
  )
}

function read(body: string, instruments = '') {
  const warnings = new WarningCollector()
  const score = readValid(source(body, instruments), warnings)
  return { score, part: score.parts[0], warnings: warnings.list() }
}

/** The kit notes of the part's first event, and the components they strike. */
function firstEvent(part: ReturnType<typeof read>['part']) {
  const item = part?.measures[0]?.sequences[0]?.content[0]
  return item?.kind === 'event' ? item : undefined
}

describe('an unpitched note', () => {
  test('strikes a kit component placed where the note is written', () => {
    const { part } = read(struck('C', '5', 'P1-I39'), DRUM_KIT)

    // C5 is the middle space of a treble staff, one step above the middle line.
    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
    ])
  })

  test('reads a display octave written with a leading zero', () => {
    const { part } = read(struck('C', '05', 'P1-I39'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
    ])
  })

  test('reads a display octave written with a plus sign', () => {
    const { part } = read(struck('C', '+5', 'P1-I39'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
    ])
  })

  // MusicXML counts octaves from 0 to 9. C5 is one step above the middle line.
  test.each([
    ['0', -34],
    ['9', 29],
  ])('places a note on a display octave of %s', (octave, staffPosition) => {
    const { part } = read(struck('C', octave, 'P1-I39'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toMatchObject([{ staffPosition }])
  })

  test.each(['-1', '10'])('places no note on a display octave of %s', (octave) => {
    const { part, warnings } = read(struck('C', octave, 'P1-I39'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toMatchObject([{ staffPosition: 0 }])
    expect(warnings.map((w) => w.code)).toEqual(['missing:display-step'])
  })

  test('is an event with no pitch, naming the component it strikes', () => {
    const { part } = read(struck('C', '5', 'P1-I39'), DRUM_KIT)
    const event = firstEvent(part)
    const [component] = [...(part?.kit.keys() ?? [])]

    expect(event?.notes).toEqual([])
    expect(event?.kitNotes.map((note) => note.component)).toEqual([component])
    expect(event?.isRest).toBe(false)
  })

  test('takes its name and its sound from the part list', () => {
    const { part, score } = read(struck('C', '5', 'P1-I39'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
    ])
    // MusicXML numbers a percussion pitch from 1 and MIDI from 0.
    expect(score.sounds.get('P1-I39')).toEqual({ name: 'Acoustic Snare', midiNumber: 38 })
  })

  // MusicXML numbers a percussion pitch from 1 and MIDI from 0, so 1 and 128
  // are the ends of the range and both are kept. Anything outside it is not a
  // sound, and the component is named without one.
  test.each([
    ['the lowest', '1', 0],
    ['the highest', '128', 127],
    ['one written across lines', '\n  39\n', 38],
    ['one written with a plus sign', '+39', 38],
  ])('keeps %s unpitched value', (_name, stated, midiNumber) => {
    const instrument =
      '<score-instrument id="P1-I1"><instrument-name>Drum</instrument-name></score-instrument>' +
      `<midi-instrument id="P1-I1"><midi-unpitched>${stated}</midi-unpitched></midi-instrument>`
    const { score } = read(struck('C', '5', 'P1-I1'), instrument)

    expect(score.sounds.get('P1-I1')).toEqual({ name: 'Drum', midiNumber })
  })

  // Number() reads "1e2" as 100, and the value must be digits alone.
  test.each(['129', '1e2'])('keeps no sound for an unpitched value of "%s"', (stated) => {
    const instrument =
      '<score-instrument id="P1-I1"><instrument-name>Drum</instrument-name></score-instrument>' +
      `<midi-instrument id="P1-I1"><midi-unpitched>${stated}</midi-unpitched></midi-instrument>`
    const { score } = read(struck('C', '5', 'P1-I1'), instrument)

    expect(score.sounds.get('P1-I1')).toEqual({ name: 'Drum', midiNumber: undefined })
  })

  test('strikes the same component as another note on the same instrument', () => {
    const { part } = read(struck('C', '5', 'P1-I39') + struck('C', '5', 'P1-I39'), DRUM_KIT)

    expect(part?.kit.size).toBe(1)
  })

  test('strikes a component of its own where another names a different instrument', () => {
    const { part } = read(struck('C', '5', 'P1-I39') + struck('G', '5', 'P1-I43'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
      { name: 'Closed Hi-Hat', staffPosition: 5, sound: 'P1-I43' },
    ])
  })

  // Two instruments drawn on one line are two components, which is how a
  // source that tells its drums apart by instrument alone writes them.
  test('strikes a component of its own where another names a different instrument at the same height', () => {
    const { part } = read(struck('C', '5', 'P1-I39') + struck('C', '5', 'P1-I43'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
      { name: 'Closed Hi-Hat', staffPosition: 1, sound: 'P1-I43' },
    ])
  })
})

// Older exporters write no <score-instrument> and no <instrument> on a note,
// so the height on the staff is all a reader has.
// A component is an instrument written at a height. A source that names one
// instrument for the whole drumset tells its drums apart by height alone, and
// keying by the instrument would draw every one of them on the same line.
describe('one instrument written at several heights', () => {
  const ONE_INSTRUMENT =
    '<score-instrument id="P1-I1"><instrument-name>Drumset</instrument-name></score-instrument>'

  test('strikes a component of its own at each height', () => {
    const { part, warnings } = read(
      struck('F', '4', 'P1-I1') + struck('C', '5', 'P1-I1') + struck('G', '5', 'P1-I1'),
      ONE_INSTRUMENT,
    )

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Drumset', staffPosition: -3, sound: 'P1-I1' },
      { name: 'Drumset', staffPosition: 1, sound: 'P1-I1' },
      { name: 'Drumset', staffPosition: 5, sound: 'P1-I1' },
    ])
    expect(warnings).toEqual([])
  })

  test('does not tie a note on one drum to a note on another', () => {
    const { warnings } = read(
      struck('F', '4', 'P1-I1', '<tie type="start"/>') +
        struck('C', '5', 'P1-I1', '<tie type="stop"/>'),
      ONE_INSTRUMENT,
    )

    expect(warnings.map((w) => w.code).sort()).toEqual(['unclosed:spanner', 'unclosed:spanner'])
  })
})

describe('an unpitched note naming no instrument', () => {
  test('strikes a component keyed by the height it is written at', () => {
    const { part, warnings } = read(struck('C', '5') + struck('G', '5') + struck('C', '5'))

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: undefined, staffPosition: 1, sound: undefined },
      { name: undefined, staffPosition: 5, sound: undefined },
    ])
    expect(warnings).toEqual([])
  })

  test('reports a note with no height to place it by, and writes it on the middle line', () => {
    const { part, warnings } = read(
      '<note><unpitched/><duration>1</duration><type>quarter</type></note>',
    )

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: undefined, staffPosition: 0, sound: undefined },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['missing:display-step'])
  })

  test('reports the missing height once, however many notes share the component', () => {
    const bare = '<note><unpitched/><duration>1</duration><type>quarter</type></note>'
    const { warnings } = read(bare + bare + bare)

    expect(warnings.map((w) => w.code)).toEqual(['missing:display-step'])
  })
})

describe('a note naming an instrument the part list does not set up', () => {
  test('keeps the component, without a name or a sound, and reports it', () => {
    const { part, warnings } = read(struck('C', '5', 'P1-I99'), DRUM_KIT)

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: undefined, staffPosition: 1, sound: undefined },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unresolved:instrument-id'])
    expect(warnings[0]?.message).toContain('P1-I99')
  })
})

// MusicXML ids are unique across the document, so a part naming an
// instrument set up under another part names nothing it can strike.
describe('a note naming an instrument set up by another part', () => {
  test('resolves nothing and reports the id', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part-list>' +
        `<score-part id="P1"><part-name>Drums</part-name>${DRUM_KIT}</score-part>` +
        '<score-part id="P2"><part-name>Blocks</part-name></score-part>' +
        '</part-list>' +
        `<part id="P1"><measure number="1">${PERCUSSION_CLEF}` +
        `${struck('C', '5', 'P1-I39')}</measure></part>` +
        `<part id="P2"><measure number="1">${PERCUSSION_CLEF}` +
        `${struck('C', '5', 'P1-I39')}</measure></part>` +
        '</score-partwise>',
      warnings,
    )
    const reported = warnings.list()

    expect([...(score.parts[1]?.kit.values() ?? [])]).toEqual([
      { name: undefined, staffPosition: 1, sound: undefined },
    ])
    expect(reported.map((one) => one.code)).toEqual(['unresolved:instrument-id'])
    expect(reported[0]?.context.part).toBe('P2')
  })
})

describe('a note struck on more than one instrument at once', () => {
  test('strikes the first and reports the rest', () => {
    const { part, warnings } = read(
      struck('C', '5', 'P1-I39').replace('</note>', '<instrument id="P1-I43"/></note>'),
      DRUM_KIT,
    )

    expect([...(part?.kit.values() ?? [])]).toEqual([
      { name: 'Acoustic Snare', staffPosition: 1, sound: 'P1-I39' },
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })
})

// The roll runs between two notes, and MNX names them by id. A kit note has no
// pitch, so the chord is ordered by the height its part's kit draws each
// component at: the snare on the third line, the hi-hat above the staff.
describe('a rolled chord struck on a kit', () => {
  const ROLLED =
    struck('C', '5', 'P1-I39', '<notations><arpeggiate/></notations>') +
    '<note><chord/><unpitched><display-step>G</display-step>' +
    '<display-octave>5</display-octave></unpitched><duration>1</duration>' +
    '<type>quarter</type><instrument id="P1-I43"/>' +
    '<notations><arpeggiate/></notations></note>'

  test('runs from the lowest component struck to the highest', () => {
    const { part, warnings } = read(ROLLED, DRUM_KIT)
    const event = firstEvent(part)
    const arpeggio = part?.measures[0]?.arpeggios[0]

    expect(arpeggio?.span).toEqual({ start: event?.kitNotes[0]?.id, end: event?.kitNotes[1]?.id })
    expect(arpeggio?.direction).toBe('up')
    expect(warnings).toEqual([])
  })

  // The mark states the direction, not the order the notes are written in, so
  // a roll drawn downwards runs from the top component to the bottom.
  test('runs the other way where the mark rolls downwards', () => {
    const downwards = ROLLED.replaceAll('<arpeggiate/>', '<arpeggiate direction="down"/>')
    const { part, warnings } = read(downwards, DRUM_KIT)
    const event = firstEvent(part)

    expect(part?.measures[0]?.arpeggios[0]?.span).toEqual({
      start: event?.kitNotes[1]?.id,
      end: event?.kitNotes[0]?.id,
    })
    expect(warnings).toEqual([])
  })

  test('writes the roll into legal MNX, naming the kit notes it runs between', () => {
    const { mnx, warnings } = convertValid(source(ROLLED, DRUM_KIT))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]
    const notes = event && 'kitNotes' in event ? event.kitNotes : []

    expect(mnx.parts[0]?.measures[0]?.arpeggios).toEqual([
      {
        position: { fraction: [0, 1] },
        span: { start: notes[0]?.id, end: notes[1]?.id },
        direction: 'up',
      },
    ])
    expect(notes.map((note) => note.id)).not.toContain(undefined)
    expect(warnings).toEqual([])
  })

  // A rest carries no note either way, and a roll drawn beside one names
  // nothing to run between.
  test('reports a roll marked on a rest', () => {
    const { warnings } = read(
      '<note><rest/><duration>1</duration><type>quarter</type>' +
        '<notations><arpeggiate/></notations></note>',
      DRUM_KIT,
    )

    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(warnings[0]?.message).toContain('rest')
  })
})

describe('a chord of unpitched notes', () => {
  const CHORD =
    struck('C', '5', 'P1-I39') +
    '<note><chord/><unpitched><display-step>G</display-step>' +
    '<display-octave>5</display-octave></unpitched><duration>1</duration>' +
    '<type>quarter</type><instrument id="P1-I43"/></note>'

  test('is one event striking both components', () => {
    const { part } = read(CHORD, DRUM_KIT)
    const event = firstEvent(part)

    expect(part?.measures[0]?.sequences[0]?.content).toHaveLength(1)
    expect(event?.kitNotes).toHaveLength(2)
    expect(event?.kitNotes.map((note) => note.component)).toEqual([...(part?.kit.keys() ?? [])])
  })

  test('refuses a rest in a chord as it does for pitched notes', () => {
    expect(() =>
      read(struck('C', '5', 'P1-I39') + '<note><chord/><rest/><duration>1</duration></note>'),
    ).toThrow(/A rest cannot be part of a chord/)
  })
})

describe('a tie between unpitched notes', () => {
  test('pairs two notes struck on the same component', () => {
    const { part } = read(
      struck('C', '5', 'P1-I39', '<tie type="start"/><notations><tied type="start"/></notations>') +
        struck('C', '5', 'P1-I39', '<tie type="stop"/><notations><tied type="stop"/></notations>'),
      DRUM_KIT,
    )
    const content = part?.measures[0]?.sequences[0]?.content ?? []
    const first = content[0]?.kind === 'event' ? content[0] : undefined
    const second = content[1]?.kind === 'event' ? content[1] : undefined

    expect(first?.kitNotes[0]?.ties).toEqual([
      { target: second?.kitNotes[0]?.id, crossVoice: false },
    ])
  })

  test('leaves a tie unpaired where the notes strike different components', () => {
    const { warnings } = read(
      struck('C', '5', 'P1-I39', '<tie type="start"/>') +
        struck('G', '5', 'P1-I43', '<tie type="stop"/>'),
      DRUM_KIT,
    )

    expect(warnings.map((w) => w.code).sort()).toEqual(['unclosed:spanner', 'unclosed:spanner'])
  })
})

describe('the MNX a percussion part converts to', () => {
  test('names the kit on the part and the component on every note', () => {
    const { mnx, warnings } = convertValid(
      source(struck('C', '5', 'P1-I39') + struck('G', '5', 'P1-I43'), DRUM_KIT),
    )
    const part = mnx.parts[0]
    const events = part?.measures[0]?.sequences[0]?.content ?? []

    expect(part?.kit).toEqual({
      kit1: { name: 'Acoustic Snare', sound: 'P1-I39', staffPosition: 1 },
      kit2: { name: 'Closed Hi-Hat', sound: 'P1-I43', staffPosition: 5 },
    })
    expect(events.map((event) => ('kitNotes' in event ? event.kitNotes : undefined))).toEqual([
      [{ kitComponent: 'kit1' }],
      [{ kitComponent: 'kit2' }],
    ])
    expect(mnx.global.sounds).toEqual({
      'P1-I39': { name: 'Acoustic Snare', midiNumber: 38 },
      'P1-I43': { name: 'Closed Hi-Hat', midiNumber: 42 },
    })
    expect(warnings).toEqual([])
  })

  test('heads the staff with the percussion clef', () => {
    const { mnx } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT))

    expect(mnx.parts[0]?.measures[0]?.clefs).toEqual([{ clef: { sign: 'P', staffPosition: -2 } }])
  })

  // MNX states the staff only where a part has more than one, so a clef
  // naming the first staff of a one-staff part states none.
  test('leaves the staff off the clef of a one-staff part', () => {
    const numbered =
      '<attributes><divisions>1</divisions>' +
      '<clef number="1"><sign>percussion</sign><line>2</line></clef></attributes>'
    const { mnx, warnings } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT, numbered))

    expect(mnx.parts[0]?.measures[0]?.clefs).toEqual([{ clef: { sign: 'P', staffPosition: -2 } }])
    expect(warnings).toEqual([])
  })

  // MNX's staffPosition is where the clef is drawn, and a percussion clef
  // names no note, so the line the source draws the clef on is carried as it is.
  test.each([
    ['1', -4],
    ['3', 0],
    ['5', 4],
  ])('draws the percussion clef on line %s', (line, staffPosition) => {
    const drawn =
      '<attributes><divisions>1</divisions>' +
      `<clef><sign>percussion</sign><line>${line}</line></clef></attributes>`
    const { mnx, warnings } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT, drawn))

    expect(mnx.parts[0]?.measures[0]?.clefs).toEqual([{ clef: { sign: 'P', staffPosition } }])
    expect(warnings).toEqual([])
  })

  // A percussion staff may be drawn on more lines than five, and the middle
  // of the staff moves with the count, so the line is read against the staff
  // it is drawn on. The top line of a seven-line staff is three lines above
  // the middle.
  test('draws the clef of a staff with more lines than five', () => {
    const drawn =
      '<attributes><divisions>1</divisions>' +
      '<staff-details><staff-lines>7</staff-lines></staff-details>' +
      '<clef><sign>percussion</sign><line>7</line></clef></attributes>'
    const { mnx, warnings } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT, drawn))

    expect(mnx.parts[0]?.measures[0]?.clefs?.[0]?.clef.staffPosition).toBe(6)
    expect(mnx.parts[0]?.measures[0]?.staffConfigs).toEqual([{ config: { lines: 7 } }])
    expect(warnings).toEqual([])
  })

  // The one line of a one-line staff is its middle, so a clef drawn on it
  // sits at nought and the notes on it sit beside it, not four steps below.
  test('draws the clef and the kit of a one-line staff on the line', () => {
    const drawn =
      '<attributes><divisions>1</divisions>' +
      '<staff-details><staff-lines>1</staff-lines></staff-details>' +
      '<clef><sign>percussion</sign><line>1</line></clef></attributes>'
    const { mnx, warnings } = convertValid(source(struck('G', '4', 'P1-I39'), DRUM_KIT, drawn))

    expect(mnx.parts[0]?.measures[0]?.clefs?.[0]?.clef.staffPosition).toBe(0)
    expect(mnx.parts[0]?.kit).toEqual({
      kit1: { name: 'Acoustic Snare', sound: 'P1-I39', staffPosition: 2 },
    })
    expect(warnings).toEqual([])
  })

  // A percussion clef places no pitch, so the heights on the staff stay where the
  // source writes them wherever the clef is drawn.
  test('leaves the staff heights where they are wherever the clef is drawn', () => {
    const drawn =
      '<attributes><divisions>1</divisions>' +
      '<clef><sign>percussion</sign><line>4</line></clef></attributes>'
    const { mnx } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT, drawn))
    const pinned = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT)).mnx

    expect(mnx.parts[0]?.kit).toEqual(pinned.parts[0]?.kit)
  })

  // A chord struck across a pitched staff and a kit sounds both at once, so
  // the event states both.
  test('states the notes and the kit notes of a chord that sounds both', () => {
    const mixed =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type></note>' +
      '<note><chord/><unpitched><display-step>G</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type><instrument id="P1-I39"/></note>'
    const { mnx } = convertValid(source(mixed, DRUM_KIT))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'notes' in event ? event.notes?.length : 0).toBe(1)
    expect(event && 'kitNotes' in event ? event.kitNotes?.length : 0).toBe(1)
  })

  // MNX reads the notes inside a roll as the ones whose pitch lies between
  // its ends, and a kit note has none, so one left out of the span is left
  // out of the roll. The span is the pitched pair and the loss is reported.
  test('reports a roll over a chord sounding on a staff and a kit at once', () => {
    const rolled =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type><notations><arpeggiate/></notations></note>' +
      '<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type><notations><arpeggiate/></notations></note>' +
      '<note><chord/><unpitched><display-step>G</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type><instrument id="P1-I39"/>' +
      '<notations><arpeggiate/></notations></note>'
    const { part, warnings } = read(rolled, DRUM_KIT)
    const event = firstEvent(part)
    const arpeggio = part?.measures[0]?.arpeggios[0]

    expect(arpeggio?.span).toEqual({ start: event?.notes[0]?.id, end: event?.notes[1]?.id })
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(warnings[0]?.element).toBe('arpeggiate')
    convertValid(source(rolled, DRUM_KIT))
  })

  // A bracket marking the chord struck together is not a roll, so the report
  // names the element the source wrote and says what it means.
  test('names the bracket for a struck chord sounding on a staff and a kit', () => {
    const struckTogether =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type><notations><non-arpeggiate type="bottom"/></notations></note>' +
      '<note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type><notations><non-arpeggiate type="top"/></notations></note>' +
      '<note><chord/><unpitched><display-step>G</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type><instrument id="P1-I39"/>' +
      '<notations><non-arpeggiate type="top"/></notations></note>'
    const { warnings } = read(struckTogether, DRUM_KIT)

    expect(warnings.map((w) => w.element)).toEqual(['non-arpeggiate'])
    expect(warnings[0]?.message).toContain('struck together')
  })

  test('says nothing was carried where the bracket holds one note', () => {
    const half =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>' +
      '<type>quarter</type><notations><non-arpeggiate type="bottom"/></notations></note>' +
      '<note><chord/><unpitched><display-step>G</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type><instrument id="P1-I39"/>' +
      '<notations><non-arpeggiate type="top"/></notations></note>'
    const { part, warnings } = read(half, DRUM_KIT)

    expect(part?.measures[0]?.arpeggios).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unclosed:spanner'])
  })

  // A mark is written on a note and a kit note carries none, so a kit chord
  // numbered two ways cannot say which of its notes each number covers.
  test('reports a kit chord marked twice under different numbers', () => {
    const numbered =
      struck('C', '5', 'P1-I39', '<notations><arpeggiate number="1"/></notations>') +
      '<note><chord/><unpitched><display-step>G</display-step>' +
      '<display-octave>5</display-octave></unpitched><duration>1</duration>' +
      '<type>quarter</type><instrument id="P1-I43"/>' +
      '<notations><arpeggiate number="2"/></notations></note>'
    const { warnings } = read(numbered, DRUM_KIT)

    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element', 'unsupported:element'])
    expect(warnings[0]?.message).toContain('different numbers')
  })

  test('writes no notes array on an event that only strikes the kit', () => {
    const { mnx } = convertValid(source(struck('C', '5', 'P1-I39'), DRUM_KIT))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event).not.toHaveProperty('notes')
  })

  test('names the note a tie reaches, so nothing points at an unwritten id', () => {
    const { mnx } = convertValid(
      source(
        struck(
          'C',
          '5',
          'P1-I39',
          '<tie type="start"/><notations><tied type="start"/></notations>',
        ) +
          struck(
            'C',
            '5',
            'P1-I39',
            '<tie type="stop"/><notations><tied type="stop"/></notations>',
          ),
        DRUM_KIT,
      ),
    )
    const events = mnx.parts[0]?.measures[0]?.sequences[0]?.content ?? []
    const first = events[0]
    const second = events[1]
    const target = first && 'kitNotes' in first ? first.kitNotes?.[0]?.ties?.[0]?.target : undefined

    expect(target).toBeDefined()
    expect(second && 'kitNotes' in second ? second.kitNotes?.[0]?.id : undefined).toBe(target)
  })

  test('writes a kit with no names where the source sets up no instruments', () => {
    const { mnx } = convertValid(source(struck('C', '5') + struck('G', '5')))

    expect(mnx.parts[0]?.kit).toEqual({
      kit1: { staffPosition: 1 },
      kit2: { staffPosition: 5 },
    })
    expect(mnx.global).not.toHaveProperty('sounds')
  })

  // A cymbal left to ring is written as a let-ring tie, which has no ending
  // note to name.
  test('writes a let-ring tie on a kit note, with nothing to point at', () => {
    const { mnx } = convertValid(
      source(struck('C', '5', 'P1-I39', '<tie type="let-ring"/>'), DRUM_KIT),
    )
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'kitNotes' in event ? event.kitNotes?.[0]?.ties : undefined).toEqual([
      { lv: true },
    ])
  })

  test('states the staff on a kit note that reaches across to the other one', () => {
    const twoStaves =
      '<score-partwise><part-list><score-part id="P1"><part-name>Drums</part-name>' +
      `${DRUM_KIT}</score-part></part-list><part id="P1"><measure number="1">` +
      '<attributes><divisions>1</divisions><staves>2</staves>' +
      '<clef number="1"><sign>percussion</sign><line>2</line></clef>' +
      '<clef number="2"><sign>percussion</sign><line>2</line></clef></attributes>' +
      '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type>' +
      '<instrument id="P1-I39"/><staff>1</staff></note>' +
      '<note><chord/><unpitched><display-step>G</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>1</duration><type>quarter</type>' +
      '<instrument id="P1-I43"/><staff>2</staff></note>' +
      '</measure></part></score-partwise>'
    const { mnx } = convertValid(twoStaves)
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'kitNotes' in event ? event.kitNotes?.map((n) => n.staff) : []).toEqual([
      undefined,
      2,
    ])
    // Each staff is headed by its own clef, and with two of them each says
    // which it heads.
    expect(mnx.parts[0]?.measures[0]?.clefs?.map((clef) => clef.staff)).toEqual([1, 2])
  })

  // A playback detail does not refuse the document. What is not read is
  // reported by the unread sweep.
  test.each([
    ['a pitch outside what MIDI counts', '<midi-unpitched>0</midi-unpitched>'],
    ['a pitch past the top of the range', '<midi-unpitched>129</midi-unpitched>'],
    ['a pitch that is not a number', '<midi-unpitched>snare</midi-unpitched>'],
  ])('converts the score and reports %s', (_name, unpitched) => {
    const { mnx, warnings } = convertValid(
      source(
        struck('C', '5', 'P1-I39'),
        '<score-instrument id="P1-I39"><instrument-name>Snare</instrument-name>' +
          `</score-instrument><midi-instrument id="P1-I39">${unpitched}</midi-instrument>`,
      ),
    )

    expect(mnx.global.sounds).toEqual({ 'P1-I39': { name: 'Snare' } })
    expect(warnings.map((w) => w.element)).toContain('midi-unpitched')
  })

  test('reports a midi-instrument that names no score-instrument, rather than dropping it', () => {
    const { warnings } = convertValid(
      source(
        struck('C', '5'),
        '<midi-instrument id="P1-I39"><midi-unpitched>39</midi-unpitched></midi-instrument>',
      ),
    )

    expect(warnings.map((w) => w.element)).toContain('midi-unpitched')
  })

  // MNX states an id as 1 to 256 printable ASCII characters, and a MusicXML
  // instrument id is an xs:ID, which allows more than that. A component has to
  // be able to name what plays it, so the instrument is renamed.
  test('renames an instrument id MNX cannot state, and keeps the link to it', () => {
    const { mnx, warnings } = convertValid(
      source(
        struck('C', '5', 'Pä-I1'),
        '<score-instrument id="Pä-I1"><instrument-name>Snare</instrument-name></score-instrument>',
      ),
    )

    expect(mnx.global.sounds).toEqual({ sound1: { name: 'Snare' } })
    expect(mnx.parts[0]?.kit).toEqual({
      kit1: { name: 'Snare', sound: 'sound1', staffPosition: 1 },
    })
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:instrument-id')
  })

  // An instrument id shaped like an id the converter generates would name a
  // sound and an event, note, kit component, measure or layout at once.
  test.each(['ev1', 'note1', 'kit1', 'm1', 'layout1'])(
    'renames the instrument id "%s", which the converter gives something else',
    (id) => {
      const { mnx, warnings } = convertValid(
        source(
          struck('C', '5', id),
          `<score-instrument id="${id}"><instrument-name>Snare</instrument-name></score-instrument>`,
        ),
      )

      expect(mnx.global.sounds).toEqual({ sound1: { name: 'Snare' } })
      expect(mnx.parts[0]?.kit?.kit1?.sound).toBe('sound1')
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:instrument-id'])
      expect(warnings[0]?.message).toContain(`"${id}"`)
      expect(warnings[0]?.message).toContain('the converter gives')
      expect(warnings[0]?.context).toEqual({ part: 'P1', line: 1 })
    },
  )

  test.each(['P1-I1', 'event1', 'sound1'])('leaves the instrument id "%s" alone', (id) => {
    const { mnx, warnings } = convertValid(
      source(
        struck('C', '5', id),
        `<score-instrument id="${id}"><instrument-name>Snare</instrument-name></score-instrument>`,
      ),
    )

    expect(Object.keys(mnx.global.sounds ?? {})).toEqual([id])
    expect(warnings).toEqual([])
  })

  // Sounds are the score's, so a name another part's instrument holds is
  // taken whichever of the two parts is read first.
  test.each([
    ['an earlier', 'sound1', 'ev1'],
    ['a later', 'ev1', 'sound1'],
  ])('skips over a name %s part’s instrument holds', (_, first, second) => {
    const drumPart = (id: string, instrument: string, name: string) => ({
      list:
        `<score-part id="${id}"><part-name>Drums</part-name>` +
        `<score-instrument id="${instrument}"><instrument-name>${name}</instrument-name>` +
        '</score-instrument></score-part>',
      part:
        `<part id="${id}"><measure number="1">${PERCUSSION_CLEF}` +
        `${struck('C', '5', instrument)}</measure></part>`,
    })
    const one = drumPart('P1', first, 'Snare')
    const two = drumPart('P2', second, 'Bass')

    const { mnx } = convertValid(
      `<score-partwise><part-list>${one.list}${two.list}</part-list>${one.part}${two.part}` +
        '</score-partwise>',
    )

    const sounds = mnx.global.sounds ?? {}
    expect(
      Object.values(sounds)
        .map((sound) => sound.name)
        .sort(),
    ).toEqual(['Bass', 'Snare'])
    const soundOf = (part: number) =>
      sounds[Object.values(mnx.parts[part]?.kit ?? {})[0]?.sound ?? '']?.name
    expect([soundOf(0), soundOf(1)]).toEqual(['Snare', 'Bass'])
  })

  test('refuses an instrument with no id', () => {
    expect(() =>
      read(
        struck('C', '5'),
        '<score-instrument><instrument-name>Snare</instrument-name></score-instrument>',
      ),
    ).toThrow(
      '<score-instrument> is missing a "id" attribute. ' +
        '(at score-partwise > part-list > score-instrument, line 1)',
    )
  })

  test('skips over a name another instrument already holds', () => {
    const { mnx, warnings } = convertValid(
      source(
        struck('C', '5', 'Pä-I1') + struck('G', '5', 'sound1'),
        '<score-instrument id="Pä-I1"><instrument-name>Snare</instrument-name></score-instrument>' +
          '<score-instrument id="sound1"><instrument-name>Hat</instrument-name></score-instrument>',
      ),
    )

    expect(Object.keys(mnx.global.sounds ?? {}).sort()).toEqual(['sound1', 'sound2'])
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:instrument-id')
  })

  test('renames an instrument of a part the list gives no id', () => {
    const { mnx, warnings } = convertValid(
      '<score-partwise><part-list><score-part>' +
        '<score-instrument id="Pä-I1"><instrument-name>Snare</instrument-name></score-instrument>' +
        '</score-part></part-list>' +
        `<part id="P1"><measure number="1">${PERCUSSION_CLEF}${struck('C', '5', 'Pä-I1')}` +
        '</measure></part></score-partwise>',
    )

    expect(mnx.global.sounds).toEqual({ sound1: { name: 'Snare' } })
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:instrument-id')
  })

  test('writes no kit for a part that strikes none', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
        '<type>quarter</type></note></measure></part></score-partwise>',
    )

    expect(mnx.parts[0]).not.toHaveProperty('kit')
  })
})
