// The words under the notes, and which way a stem points. A note carries one
// <lyric> per verse, and each says how its syllable joins the ones around it.
// MNX states the lyric on the event, keyed by verse, with a line type where
// the syllable is part of a word.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
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
  const score = readValid(source, warnings)
  const events = (score.parts[0]?.measures[0]?.sequences[0]?.content ?? []).filter(
    (item): item is Event => item.kind === 'event',
  )
  return { events, warnings: warnings.list() }
}

describe('lyrics', () => {
  test('states the syllable on the event, keyed by verse', () => {
    const { events } = read(measure(note('C', lyric('Are'))))

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'Are', type: undefined }]]))
  })

  test('reads a word split across notes as a start, middle and end', () => {
    const { events } = read(
      measure(note('C', lyric('Brun', 'begin')) + note('D', lyric('nen', 'end'))),
    )

    expect(events[0]?.lyrics.get('1')?.type).toBe('start')
    expect(events[1]?.lyrics.get('1')?.type).toBe('end')
  })

  test('reads a middle syllable', () => {
    const { events } = read(measure(note('C', lyric('ll', 'middle'))))

    expect(events[0]?.lyrics.get('1')?.type).toBe('middle')
  })

  test('leaves the type off a syllable that stands on its own', () => {
    const { events } = read(measure(note('C', lyric('vor', 'single'))))

    expect(events[0]?.lyrics.get('1')?.type).toBeUndefined()
  })

  test('keeps the verses apart by their number', () => {
    const { events } = read(
      measure(note('C', lyric('Are', 'single', '1') + lyric('Am', 'single', '2'))),
    )

    expect(events[0]?.lyrics).toEqual(
      new Map([
        ['1', { text: 'Are', type: undefined }],
        ['2', { text: 'Am', type: undefined }],
      ]),
    )
  })

  test('reads a lyric with no syllabic as standing on its own', () => {
    const { events } = read(measure(note('C', '<lyric number="1"><text>Ah</text></lyric>')))

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'Ah', type: undefined }]]))
  })

  test('drops the whitespace around a syllable, which nobody sings', () => {
    const { events } = read(measure(note('C', '<lyric number="1"><text>o </text></lyric>')))

    expect(events[0]?.lyrics.get('1')?.text).toBe('o')
  })

  // Two syllables sung on one note are written as two <text>s, and the space
  // between them is the source saying they are two words. Trimming the ends
  // of the join must not reach it.
  test('keeps the space the source put between two syllables', () => {
    const { events } = read(
      measure(note('C', '<lyric number="1"><text>y</text><text>  </text><text>a</text></lyric>')),
    )

    expect(events[0]?.lyrics.get('1')?.text).toBe('y  a')
  })

  // A syllabic of "end" over a space is how a source closes a melisma with
  // nothing drawn. There is no syllable in it, so there is no verse.
  test('reads a syllable of nothing but whitespace as stating no words', () => {
    const { events, warnings } = read(
      measure(note('C', '<lyric number="1"><syllabic>end</syllabic><text> </text></lyric>')),
    )

    expect(events[0]?.lyrics.size).toBe(0)
    expect(warnings).toEqual([])
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

    expect([...(events[0]?.lyrics.keys() ?? [])]).toEqual(['1'])
  })

  test('gives a note no lyrics when it carries none', () => {
    const { events } = read(measure(note('C')))

    expect(events[0]?.lyrics.size).toBe(0)
  })

  // MNX's event lyric states a text and a type, and nothing about visibility.
  // A hidden lyric is reported under the "print-object" code, like every
  // hidden element.
  test('reports a lyric hidden with print-object="no", and draws it anyway', () => {
    const { events, warnings } = read(
      measure(note('C', '<lyric number="1" print-object="no"><text>Ah</text></lyric>')),
    )

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'Ah', type: undefined }]]))
    expect(warnings).toMatchObject([
      {
        code: 'unrepresentable:attribute',
        message:
          'A <lyric> hidden with print-object="no" is drawn anyway, because MNX cannot ' +
          'mark it invisible.',
        element: 'lyric',
        attribute: 'print-object',
      },
    ])
  })

  // Hiding a lyric that draws no words hides nothing, so there is nothing to
  // report about the hiding. The <extend> is the melisma line, which is a
  // real loss and reports itself.
  test('says nothing about hiding a lyric that draws no words', () => {
    const { warnings } = read(
      measure(note('C', '<lyric number="1" print-object="no"><extend/></lyric>')),
    )

    expect(warnings.map((w) => w.element)).toEqual(['extend'])
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

// A verse is not always one <text>. Where two syllables are sung on one
// note, as is common in French, MusicXML writes each as its own <text> with
// the elision character between them.
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

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'le aux', type: 'end' }]]))
    expect(warnings).toEqual([])
  })

  // Some exporters write the pieces with no <elision>. Nothing is added
  // between them.
  test('joins them with nothing where the source states no elision', () => {
    const { events } = read(
      measure(
        note(
          'C',
          '<lyric number="1"><syllabic>end</syllabic><text>_</text><text> rait</text></lyric>',
        ),
      ),
    )

    expect(events[0]?.lyrics.get('1')?.text).toBe('_ rait')
  })

  // A pretty-printer writes each <text> on its own indented line, so the
  // pieces arrive with the line break inside them. hensel-1-sehnsucht writes
  // the same verse both ways: "2." and "\u00a0\u00a0Horch!" run together,
  // while "1." carries the break.
  test('drops a line break the source only wrote to lay the pieces out', () => {
    const { events } = read(
      measure(
        note(
          'C',
          '<lyric number="1"><syllabic>single</syllabic><text>1.\n</text>' +
            '<text>\u00a0\u00a0Fern\n</text><text></text></lyric>',
        ),
      ),
    )

    expect(events[0]?.lyrics.get('1')?.text).toBe('1.\u00a0\u00a0Fern')
  })

  // A no-break space is an indent the source draws. Trimming each piece would
  // remove it and join "y" and "a" as "ya".
  test('keeps a no-break space the line break was written around', () => {
    const { events } = read(
      measure(note('C', '<lyric number="1"><text>y\n</text><text>\u00a0\u00a0a</text></lyric>')),
    )

    expect(events[0]?.lyrics.get('1')?.text).toBe('y\u00a0\u00a0a')
  })

  // The rule turns on the line break, so a plain space between two pieces is
  // still the separator the source chose.
  test('keeps a space between the pieces where no line break was written', () => {
    const { events } = read(
      measure(note('C', '<lyric number="1"><text>le </text><text>aux</text></lyric>')),
    )

    expect(events[0]?.lyrics.get('1')?.text).toBe('le aux')
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

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'to-day', type: 'start' }]]))
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-syllabic'])
  })

  test('reports the syllabics it cannot state at the first one not converted', () => {
    const source = measure(
      note(
        'C',
        '<lyric number="1"><syllabic>begin</syllabic><text>to</text>\n' +
          '<elision>-</elision><syllabic>end</syllabic><text>day</text></lyric>',
      ),
    )
    const { warnings } = read(source)

    const second = source.split('\n').findIndex((line) => line.includes('<syllabic>end')) + 1
    expect(warnings.map((w) => [w.element, w.context.line])).toEqual([['syllabic', second]])
  })

  // A <lyric> holding only an <extend> is how MusicXML continues a melisma
  // under a later note. There is no syllable in it to write.
  test('states no verse for a lyric that is only a melisma line', () => {
    const { events, warnings } = read(measure(note('C', '<lyric number="1"><extend/></lyric>')))

    expect(events[0]?.lyrics.size).toBe(0)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:element'])
  })
})

// The source states which verse is which; the document states their order,
// so a consumer need not infer it from where each verse first appears.
describe('the order of the verse lines', () => {
  test('states the lines in verse order, not appearance order', () => {
    const { mnx, warnings } = convertValid(
      measure(
        note('C', lyric('la', 'single', '2')) +
          note('D', lyric('one', 'single', '1') + lyric('two', 'single', '2')) +
          note('E', lyric('ten', 'single', '10')),
      ),
    )

    expect(mnx.global.lyrics).toEqual({ lineOrder: ['1', '2', '10'] })
    expect(warnings).toEqual([])
  })

  test('states the order of two verses', () => {
    const { mnx } = convertValid(
      measure(note('C', lyric('one', 'single', '1') + lyric('two', 'single', '2'))),
    )

    expect(mnx.global.lyrics).toEqual({ lineOrder: ['1', '2'] })
  })

  test('states no order for a single verse, which has none to state', () => {
    const { mnx } = convertValid(measure(note('C', lyric('la'))))

    expect('lyrics' in mnx.global).toBe(false)
  })

  test('states no order where nothing sings', () => {
    const { mnx } = convertValid(measure(note('C')))

    expect('lyrics' in mnx.global).toBe(false)
  })
})

// MNX keys an event's lyrics by line, so two on one line collapse to one.
// Sources do write the same <lyric number="1"> twice on one note. Where the
// two differ, one is dropped and reported.
describe('one line stated twice on a note', () => {
  test('carries the first and reports the second where they differ', () => {
    const { events, warnings } = read(measure(note('C', lyric('FIRST') + lyric('SECOND'))))

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'FIRST', type: undefined }]]))
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-line'])
    expect(warnings[0]?.message).toContain('SECOND')
  })

  test('writes the first onto schema-valid MNX', () => {
    const { mnx } = convertValid(measure(note('C', lyric('FIRST') + lyric('SECOND'))))
    const event = mnx.parts[0]?.measures[0]?.sequences[0]?.content[0]

    expect(event && 'lyrics' in event ? event.lyrics?.lines : undefined).toEqual({
      '1': { text: 'FIRST' },
    })
  })

  test('carries one and says nothing where the two say the same thing', () => {
    const { events, warnings } = read(measure(note('C', lyric('same') + lyric('same'))))

    expect(events[0]?.lyrics).toEqual(new Map([['1', { text: 'same', type: undefined }]]))
    expect(warnings).toEqual([])
  })

  // The two texts agree, so the words are whole, but the syllabic says how
  // the syllable joins its word and only one of the two reaches the output.
  test('reports two that agree on the words and not on the syllabic', () => {
    const { warnings } = read(measure(note('C', lyric('sing', 'begin') + lyric('sing', 'end'))))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:lyric-line'])
  })
})
