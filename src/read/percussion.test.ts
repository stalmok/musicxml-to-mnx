// A percussion part writes notes with no pitch: a height on the staff and the
// instrument struck at it. MNX names each instrument once, on the part's kit,
// and every note of the part names the component it strikes.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

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

function source(body: string, instruments = ''): string {
  return (
    '<score-partwise><part-list><score-part id="P1"><part-name>Drums</part-name>' +
    `${instruments}</score-part></part-list>` +
    `<part id="P1"><measure number="1">${PERCUSSION_CLEF}${body}</measure></part>` +
    '</score-partwise>'
  )
}

function read(body: string, instruments = '') {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source(body, instruments)), warnings)
  // Every one of these is written under a percussion clef, which MNX cannot
  // state and which is reported once per part. What each test is about is
  // whatever else it reports.
  const reported = warnings.list().filter((one) => one.code !== 'unrepresentable:clef-sign')
  return { score, part: score.parts[0], warnings: reported }
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
})

// Older exporters write no <score-instrument> and no <instrument> on a note.
// The height on the staff is then all a reader has, and it is what the page
// gives a player too.
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
    const { mnx, warnings } = convertMusicXML(
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
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:clef-sign'])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no notes array on an event that only strikes the kit', () => {
    const { mnx } = convertMusicXML(source(struck('C', '5', 'P1-I39'), DRUM_KIT))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event).not.toHaveProperty('notes')
  })

  test('names the note a tie reaches, so nothing points at an unwritten id', () => {
    const { mnx } = convertMusicXML(
      source(
        struck('C', '5', 'P1-I39', '<tie type="start"/>') +
          struck('C', '5', 'P1-I39', '<tie type="stop"/>'),
        DRUM_KIT,
      ),
    )
    const events = mnx.parts[0]?.measures[0]?.sequences[0]?.content ?? []
    const first = events[0]
    const second = events[1]
    const target = first && 'kitNotes' in first ? first.kitNotes?.[0]?.ties?.[0]?.target : undefined

    expect(target).toBeDefined()
    expect(second && 'kitNotes' in second ? second.kitNotes?.[0]?.id : undefined).toBe(target)
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes a kit with no names where the source sets up no instruments', () => {
    const { mnx } = convertMusicXML(source(struck('C', '5') + struck('G', '5')))

    expect(mnx.parts[0]?.kit).toEqual({
      kit1: { staffPosition: 1 },
      kit2: { staffPosition: 5 },
    })
    expect(mnx.global).not.toHaveProperty('sounds')
    expect(schemaErrors(mnx)).toEqual([])
  })

  // A cymbal left to ring is written as a let-ring tie, which has no ending
  // note to name.
  test('writes a let-ring tie on a kit note, with nothing to point at', () => {
    const { mnx } = convertMusicXML(
      source(struck('C', '5', 'P1-I39', '<tie type="let-ring"/>'), DRUM_KIT),
    )
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'kitNotes' in event ? event.kitNotes?.[0]?.ties : undefined).toEqual([
      { lv: true },
    ])
    expect(schemaErrors(mnx)).toEqual([])
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
    const { mnx } = convertMusicXML(twoStaves)
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'kitNotes' in event ? event.kitNotes?.map((n) => n.staff) : []).toEqual([
      undefined,
      2,
    ])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes no kit for a part that strikes none', () => {
    const { mnx } = convertMusicXML(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>1</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
        '<type>quarter</type></note></measure></part></score-partwise>',
    )

    expect(mnx.parts[0]).not.toHaveProperty('kit')
  })
})
