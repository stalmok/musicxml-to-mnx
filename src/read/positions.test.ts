// Where the reader says a problem is.
//
// A refusal states the document path and the source line; a warning states
// the part, the measure and the line it came from. That is the documented
// guarantee, and nothing held the reader to it: a mutation run emptied the
// location at every throw and warn site in this directory and no test failed.
// The messages were compared, the places they name were not.
//
// Each source below writes one element per line, so a reported line names
// which element the reader was reading rather than the whole document.

import { describe, expect, test } from 'vitest'
import { MusicXMLError } from '../errors.js'
import { WarningCollector } from '../warnings.js'
import type { ConversionWarning } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

/** The line the first body element of `score` lands on. */
const FIRST_BODY_LINE = 5

function score(...body: readonly string[]): string {
  return [
    '<score-partwise>',
    '<part id="P1">',
    '<measure number="7">',
    '<attributes><divisions>4</divisions></attributes>',
    ...body,
    '</measure>',
    '</part>',
    '</score-partwise>',
  ].join('\n')
}

/** The line the <measure> itself is on, which is where the measure as a whole is read. */
const MEASURE_LINE = 3

// A report counts the measure's place in the part, while the path names the
// number the source wrote on it. The measure above is the first, and is
// labelled 7, so the two differ and each test says which it means.
const MEASURE_POSITION = 1

const note = (step: string, duration: number, type = 'quarter', extra = ''): string =>
  `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch>` +
  `<duration>${String(duration)}</duration><type>${type}</type></note>`

// No <type>: a marked rest the source states a value for can stand as an
// ordinary rest, and the reading that keeps it one is settled once the voice
// is whole. Without one the mark is taken as written, which is what refuses.
const FULL_REST = '<note><rest measure="yes"/><duration>16</duration></note>'

const backup = (duration: number): string =>
  `<backup><duration>${String(duration)}</duration></backup>`

/** A note inside a 3:2 eighth tuplet, carrying the markers given. */
const tupletNote = (step: string, markers = ''): string =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration>` +
  '<type>eighth</type>' +
  '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
  '</time-modification>' +
  (markers ? `<notations>${markers}</notations>` : '') +
  '</note>'

/** One note of a two-note tremolo: written as a half, lasting a quarter. */
const tremoloNote = (step: string, type: string, duration = 4, marks = '3'): string =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
  `<duration>${String(duration)}</duration><type>half</type>` +
  '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
  '</time-modification>' +
  `<notations><ornaments><tremolo type="${type}">${marks}</tremolo></ornaments></notations></note>`

function refusal(source: string): MusicXMLError {
  try {
    readScore(parseXmlRoot(source), new WarningCollector())
  } catch (error) {
    if (error instanceof MusicXMLError) return error
    throw error
  }
  throw new Error('Expected the read to fail, but it succeeded.')
}

function warningsOf(source: string): readonly ConversionWarning[] {
  const warnings = new WarningCollector()
  readScore(parseXmlRoot(source), warnings)
  return warnings.list()
}

// Each entry names the body of a measure that cannot be read, and which of
// its lines the reader should point at.
const REFUSALS: readonly { what: string; body: readonly string[]; at: number }[] = [
  { what: 'a note after a rest that fills the measure', body: [FULL_REST, note('C', 4)], at: 1 },
  {
    what: 'a chord member with nothing to join',
    body: [note('C', 4, 'quarter', '<chord/>')],
    at: 0,
  },
  {
    what: 'a chord member lasting a different time',
    body: [note('C', 4), note('E', 8, 'half', '<chord/>')],
    at: 1,
  },
  {
    what: 'a second rest filling the measure',
    body: [FULL_REST, backup(16), FULL_REST],
    at: 2,
  },
  {
    what: 'a rest filling the measure after notes',
    body: [note('C', 4), FULL_REST],
    at: 1,
  },
  {
    what: 'a tuplet starting inside a tremolo',
    body: [tremoloNote('C', 'start'), tupletNote('D', '<tuplet type="start"/>')],
    at: 1,
  },
  {
    what: 'a tremolo starting inside another',
    body: [tremoloNote('C', 'start'), tremoloNote('D', 'start')],
    at: 1,
  },
  { what: 'a tremolo stopping where none is open', body: [tremoloNote('C', 'stop')], at: 0 },
  {
    what: 'a tremolo holding something other than two notes',
    body: [tremoloNote('C', 'start'), note('D', 4), tremoloNote('E', 'stop')],
    at: 2,
  },
  {
    what: 'a tremolo whose two notes last different times',
    body: [tremoloNote('C', 'start'), tremoloNote('E', 'stop', 8)],
    at: 1,
  },
  {
    what: 'a tuplet closing inside a tremolo',
    body: [
      tupletNote('C', '<tuplet type="start"/>'),
      tremoloNote('D', 'start'),
      tupletNote('E', '<tuplet type="stop"/>'),
    ],
    at: 2,
  },
  {
    what: 'a backup that states no duration',
    body: [note('C', 4), '<backup/>'],
    at: 1,
  },
  {
    // Five sixteenths of a whole note is no note value, so the pair the
    // tremolo occupies cannot be written.
    what: 'a tremolo whose notes last a time no note value can write',
    body: [tremoloNote('C', 'start', 5), tremoloNote('E', 'stop', 5)],
    at: 1,
  },
]

describe('the place a refusal names', () => {
  test.each(REFUSALS)('points at $what', ({ body, at }) => {
    const error = refusal(score(...body))

    expect(error.path).toEqual(['score-partwise', 'part P1', 'measure 7'])
    expect(error.line).toBe(FIRST_BODY_LINE + at)
  })

  // A tremolo the measure never closes is found once the measure is whole, so
  // the measure itself is the place.
  test('points at the measure for a tremolo left open', () => {
    const error = refusal(score(tremoloNote('C', 'start')))

    expect(error.path).toEqual(['score-partwise', 'part P1', 'measure 7'])
    expect(error.line).toBe(MEASURE_LINE)
  })
})

describe('the place a warning names', () => {
  // Each entry is a measure body, the code it reports, and which of its lines
  // the report should carry.
  const REPORTS: readonly { what: string; body: readonly string[]; code: string; at: number }[] = [
    {
      what: 'a duration before any divisions',
      body: [
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>' +
          '<type>quarter</type></note>',
      ],
      code: 'missing:divisions',
      at: 0,
    },
    {
      what: 'a backup reaching past the measure start',
      // The second voice starts where the backup left the cursor, so nothing
      // overlaps and the clamp is the only thing reported.
      body: [
        note('C', 4, 'quarter', '') + '',
        backup(16),
        '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>2</voice></note>',
      ],
      code: 'inconsistent:backup',
      at: 1,
    },
    {
      what: 'the backup that reached past the start, not the forward returning from it',
      // The forward does not bring the cursor back inside the measure, so the
      // voice that follows is written at the start and the reach is reported.
      // The <backup> is what reached, so it is the line named.
      body: [
        note('C', 4) + '',
        backup(16),
        '<forward><duration>4</duration></forward>',
        '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>2</voice></note>',
      ],
      code: 'inconsistent:backup',
      at: 1,
    },
    {
      what: 'the two ends of a tremolo counting different beams',
      body: [tremoloNote('C', 'start'), tremoloNote('E', 'stop', 4, '2')],
      code: 'inconsistent:tremolo',
      at: 1,
    },
  ]

  test.each(REPORTS)('points at $what', ({ body, code, at }) => {
    const source = code === 'missing:divisions' ? withoutDivisions(...body) : score(...body)
    const reported = warningsOf(source).find((warning) => warning.code === code)

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
    expect(reported?.context.line).toBe(FIRST_BODY_LINE + at)
  })

  // A tuplet whose content disagrees with its stated ratio is weighed where
  // the bracket closes.
  test('points at the note a tuplet closes on', () => {
    const reported = warningsOf(
      score(tupletNote('C', '<tuplet type="start"/>'), tupletNote('D', '<tuplet type="stop"/>')),
    ).find((warning) => warning.code === 'inconsistent:tuplet')

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
    expect(reported?.context.line).toBe(FIRST_BODY_LINE + 1)
  })

  // A start marker stating its own ratio is weighed against the notes' own
  // <time-modification>, on the note the bracket opens on.
  test('points at the note a bracket states a disagreeing ratio on', () => {
    const fiveInFour =
      '<tuplet-actual><tuplet-number>5</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-actual>' +
      '<tuplet-normal><tuplet-number>4</tuplet-number><tuplet-type>eighth</tuplet-type>' +
      '</tuplet-normal>'
    const reported = warningsOf(
      score(
        tupletNote('C', `<tuplet type="start">${fiveInFour}</tuplet>`),
        tupletNote('D', '<tuplet type="stop"/>'),
      ),
    ).find((warning) => warning.message.includes('states a ratio that disagrees'))

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
    expect(reported?.context.line).toBe(FIRST_BODY_LINE)
  })

  // A bracket still open at the barline is closed there, which is found once
  // the measure is whole, so the report carries the measure's own line.
  test('points at the measure for a tuplet cut at the barline', () => {
    const reported = warningsOf(score(tupletNote('C', '<tuplet type="start"/>'))).find(
      (warning) => warning.code === 'unrepresentable:tuplet-span',
    )

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
    expect(reported?.context.line).toBe(MEASURE_LINE)
  })

  // A roll is drawn beside a chord rather than on a note, so its report names
  // the measure it is in and no line of its own.
  test('names the measure for a roll marked on a rest', () => {
    const reported = warningsOf(
      score(
        '<note><rest/><duration>4</duration><type>quarter</type>' +
          '<notations><arpeggiate/></notations></note>',
      ),
    ).find((warning) => warning.element === 'arpeggiate')

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
  })

  // A note naming no voice beside notes that do is a report about the measure
  // rather than about any one line of it, so it carries the measure alone.
  test('names the measure where the report is about the whole of it', () => {
    const reported = warningsOf(
      score(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
          '<type>quarter</type><voice>1</voice></note>',
        backup(4),
        note('G', 4),
      ),
    ).find((warning) => warning.code === 'missing:voice')

    expect(reported?.context.part).toBe('P1')
    expect(reported?.context.measure).toBe(MEASURE_POSITION)
  })
})

/** The same measure with no <divisions>, for the report that a duration precedes one. */
function withoutDivisions(...body: readonly string[]): string {
  return [
    '<score-partwise>',
    '<part id="P1">',
    '<measure number="7">',
    '<attributes><staves>1</staves></attributes>',
    ...body,
    '</measure>',
    '</part>',
    '</score-partwise>',
  ].join('\n')
}
