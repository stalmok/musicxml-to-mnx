// The words under the notes, and which way a stem points. A note carries one
// <lyric> per verse, and each says how its syllable joins the ones around it.
// MNX states the lyric on the event, keyed by verse, with a line type where
// the syllable is part of a word.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'
import type { Event } from '../model/score.js'

function note(step: string, body = ''): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`
  )
}

function lyric(text: string, syllabic = 'single', number = '1'): string {
  return `<lyric number="${number}"><syllabic>${syllabic}</syllabic><text>${text}</text></lyric>`
}

function measure(body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions></attributes>' +
    `${body}</measure></part></score-partwise>`
  )
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  const events = (score.parts[0]?.measures[0]?.sequences[0]?.content ?? []).filter(
    (item): item is Event => item.kind === 'event',
  )
  return { events, warnings: warnings.list() }
}

describe('lyrics', () => {
  test('states the syllable on the event, keyed by verse', () => {
    const { events } = read(measure(note('C', lyric('Are'))))

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'Are', type: undefined }])
  })

  test('reads a word split across notes as a start, middle and end', () => {
    const { events } = read(
      measure(note('C', lyric('Brun', 'begin')) + note('D', lyric('nen', 'end'))),
    )

    expect(events[0]?.lyrics[0]?.type).toBe('start')
    expect(events[1]?.lyrics[0]?.type).toBe('end')
  })

  test('reads a middle syllable', () => {
    const { events } = read(measure(note('C', lyric('ll', 'middle'))))

    expect(events[0]?.lyrics[0]?.type).toBe('middle')
  })

  test('leaves the type off a syllable that stands on its own', () => {
    const { events } = read(measure(note('C', lyric('vor', 'single'))))

    expect(events[0]?.lyrics[0]?.type).toBeUndefined()
  })

  test('keeps the verses apart by their number', () => {
    const { events } = read(
      measure(note('C', lyric('Are', 'single', '1') + lyric('Am', 'single', '2'))),
    )

    expect(events[0]?.lyrics).toEqual([
      { line: '1', text: 'Are', type: undefined },
      { line: '2', text: 'Am', type: undefined },
    ])
  })

  test('reads a lyric with no syllabic as standing on its own', () => {
    const { events } = read(measure(note('C', '<lyric number="1"><text>Ah</text></lyric>')))

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'Ah', type: undefined }])
  })

  test('keeps the text exactly, spaces and all', () => {
    const { events } = read(measure(note('C', '<lyric number="1"><text>o </text></lyric>')))

    expect(events[0]?.lyrics[0]?.text).toBe('o ')
  })

  test('reports a syllabic it does not know rather than dropping the type', () => {
    const { warnings } = read(
      measure(note('C', '<lyric number="1"><syllabic>trailing</syllabic><text>x</text></lyric>')),
    )

    expect(warnings.map((w) => w.message)).toContain(
      'A <syllabic> of "trailing" is not converted yet.',
    )
  })

  test('takes a lyric with no verse number as the first verse', () => {
    const { events } = read(measure(note('C', '<lyric><text>Ah</text></lyric>')))

    expect(events[0]?.lyrics[0]?.line).toBe('1')
  })

  test('gives a note no lyrics when it carries none', () => {
    const { events } = read(measure(note('C')))

    expect(events[0]?.lyrics).toEqual([])
  })

  // MNX's event lyric states a text and a type, and nothing about visibility,
  // so a hidden lyric is reported the way every hidden element is: under the
  // "print-object" code, not as an unread attribute.
  test('reports a lyric hidden with print-object="no", and draws it anyway', () => {
    const { events, warnings } = read(
      measure(note('C', '<lyric number="1" print-object="no"><text>Ah</text></lyric>')),
    )

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'Ah', type: undefined }])
    expect(warnings).toMatchObject([
      {
        code: 'unsupported:element',
        message:
          'A <lyric> hidden with print-object="no" is drawn anyway, because MNX cannot ' +
          'mark it invisible.',
        element: 'print-object',
      },
    ])
  })
})

describe('stem direction', () => {
  test('reads a stem pointing up', () => {
    const { events } = read(measure(note('C', '<stem>up</stem>')))

    expect(events[0]?.stemDirection).toBe('up')
  })

  test('reads a stem pointing down', () => {
    const { events } = read(measure(note('C', '<stem>down</stem>')))

    expect(events[0]?.stemDirection).toBe('down')
  })

  // MNX states only up or down; "none" and "double" have no place there.
  test('leaves the direction unset where the stem is neither up nor down', () => {
    const { events, warnings } = read(measure(note('C', '<stem>none</stem>')))

    expect(events[0]?.stemDirection).toBeUndefined()
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:stem-direction')
  })

  test('leaves the direction unset where there is no stem', () => {
    const { events } = read(measure(note('C')))

    expect(events[0]?.stemDirection).toBeUndefined()
  })
})

// A verse is not always one <text>. Where two syllables are sung on one note,
// which French sets constantly, MusicXML writes each as its own <text> with
// the elision character between them. Taking only the first lost half the word,
// silently: fourteen lyrics in the vendored corpus do it.
describe('a verse written as several pieces', () => {
  test('joins the pieces with whatever the source put between them', () => {
    const { events, warnings } = read(
      measure(
        note(
          'C',
          '<lyric number="1"><syllabic>end</syllabic><text>le</text>' +
            '<elision> </elision><text>aux</text></lyric>',
        ),
      ),
    )

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'le aux', type: 'end' }])
    expect(warnings).toEqual([])
  })

  // Some exporters write the pieces with no <elision> at all, and the corpus
  // contains fourteen of those. Nothing is invented to sit between them.
  test('joins them with nothing where the source states no elision', () => {
    const { events } = read(
      measure(
        note(
          'C',
          '<lyric number="1"><syllabic>end</syllabic><text>_</text><text> rait</text></lyric>',
        ),
      ),
    )

    expect(events[0]?.lyrics.map((l) => l.text)).toEqual(['_ rait'])
  })

  test('reports the syllabics it cannot state, keeping the first', () => {
    const { events, warnings } = read(
      measure(
        note(
          'C',
          '<lyric number="1"><syllabic>begin</syllabic><text>to</text>' +
            '<elision>-</elision><syllabic>end</syllabic><text>day</text></lyric>',
        ),
      ),
    )

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'to-day', type: 'start' }])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-syllabic'])
  })

  // A <lyric> holding only an <extend> is how MusicXML continues a melisma
  // under a later note. There is no syllable in it to write.
  test('states no verse for a lyric that is only a melisma line', () => {
    const { events, warnings } = read(measure(note('C', '<lyric number="1"><extend/></lyric>')))

    expect(events[0]?.lyrics).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })
})

// The source states which verse is which; the document states their order,
// so a consumer need not infer it from where each verse first appears.
describe('the order of the verse lines', () => {
  test('states the lines in verse order, not appearance order', () => {
    const { mnx, warnings } = convertMusicXML(
      measure(
        note('C', lyric('la', 'single', '2')) +
          note('D', lyric('one', 'single', '1') + lyric('two', 'single', '2')) +
          note('E', lyric('ten', 'single', '10')),
      ),
    )

    expect(mnx.global.lyrics).toEqual({ lineOrder: ['1', '2', '10'] })
    expect(warnings).toEqual([])
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('states no order for a single verse, which has none to state', () => {
    const { mnx } = convertMusicXML(measure(note('C', lyric('la'))))

    expect('lyrics' in mnx.global).toBe(false)
  })

  test('states no order where nothing sings', () => {
    const { mnx } = convertMusicXML(measure(note('C')))

    expect('lyrics' in mnx.global).toBe(false)
  })
})

// MNX keys an event's lyrics by line, so two on one line collapse to one.
// A source does write the same <lyric number="1"> twice on one note, and
// where the two say the same thing nothing is lost. Where they differ, one
// of them is dropped and the drop has to be reported.
describe('one line stated twice on a note', () => {
  test('carries the first and reports the second where they differ', () => {
    const { events, warnings } = read(measure(note('C', lyric('FIRST') + lyric('SECOND'))))

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'FIRST', type: undefined }])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-line'])
    expect(warnings[0]?.message).toContain('SECOND')
  })

  test('carries one and says nothing where the two say the same thing', () => {
    const { events, warnings } = read(measure(note('C', lyric('same') + lyric('same'))))

    expect(events[0]?.lyrics).toEqual([{ line: '1', text: 'same', type: undefined }])
    expect(warnings).toEqual([])
  })

  // The two texts agree, so the words are whole, but the syllabic says how
  // the syllable joins its word and only one of the two reaches the output.
  test('reports two that agree on the words and not on the syllabic', () => {
    const { warnings } = read(measure(note('C', lyric('sing', 'begin') + lyric('sing', 'end'))))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-line'])
  })
})
