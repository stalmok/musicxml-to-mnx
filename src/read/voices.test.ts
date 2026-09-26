// MusicXML writes a measure as one stream with a cursor: <backup> rewinds it
// so another voice can be written over the same span, and <chord> attaches a
// note to the one before it. MNX states each voice as its own sequence. These
// cover the translation between the two.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import { fraction } from '../fraction.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

const DIVISIONS = '<attributes><divisions>4</divisions></attributes>'

/** A note of `duration` quarters, in `voice`, at the given pitch step. */
function note(step: string, quarters: number, voice = '1', extra = ''): string {
  return (
    `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(quarters * 4)}</duration><voice>${voice}</voice></note>`
  )
}

function measure(body: string): string {
  return `<score-partwise><part id="P1"><measure number="1">${DIVISIONS}${body}</measure></part></score-partwise>`
}

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readScore(parseXmlRoot(source), warnings)
  return { measure: result.parts[0]?.measures[0], warnings: warnings.list() }
}

function readFailure(source: string): MusicXMLError {
  try {
    read(source)
  } catch (e) {
    if (e instanceof MusicXMLError) return e
    throw e
  }
  throw new Error('Expected the read to fail, but it succeeded.')
}

describe('voices', () => {
  test('gives each voice its own sequence', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          note('E', 1, '1') +
          '<backup><duration>8</duration></backup>' +
          note('G', 2, '2'),
      ),
    )

    expect(result?.sequences).toHaveLength(2)
    expect(result?.sequences[0]?.voice).toBe('1')
    expect(result?.sequences[1]?.voice).toBe('2')
  })

  test('keeps voices in the order they first appear', () => {
    const { measure: result } = read(
      measure(note('C', 1, '2') + '<backup><duration>4</duration></backup>' + note('G', 1, '1')),
    )

    expect(result?.sequences.map((s) => s.voice)).toEqual(['2', '1'])
  })

  test('treats a measure with no voice given as a single voice', () => {
    const { measure: result } = read(
      measure('<note><rest/><duration>4</duration><type>quarter</type></note>'),
    )

    expect(result?.sequences).toHaveLength(1)
    expect(result?.sequences[0]?.voice).toBeUndefined()
  })

  test('puts each voice’s own notes in it', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>8</duration></backup>' + note('G', 2, '2')),
    )

    const pitchOf = (index: number) => {
      const item = result?.sequences[index]?.content[0]
      return item?.kind === 'event' ? item.notes[0]?.pitch.step : undefined
    }

    expect(pitchOf(0)).toBe('C')
    expect(pitchOf(1)).toBe('G')
  })
})

describe('chords', () => {
  test('folds a chord note into the event before it', () => {
    const { measure: result } = read(measure(note('C', 1) + note('E', 1, '1', '<chord/>')))
    const content = result?.sequences[0]?.content

    expect(content).toHaveLength(1)
    expect(content?.[0]?.kind === 'event' && content[0].notes).toHaveLength(2)
  })

  test('does not let a chord note advance the cursor', () => {
    const { measure: result } = read(
      measure(
        note('C', 1) +
          note('E', 1, '1', '<chord/>') +
          '<backup><duration>4</duration></backup>' +
          note('G', 1, '2'),
      ),
    )

    // Voice 2 starts where voice 1 started, so it needs no space before it.
    expect(result?.sequences[1]?.content).toHaveLength(1)
  })

  test('rejects a chord note with nothing to attach to', () => {
    expect(readFailure(measure(note('C', 1, '1', '<chord/>'))).message).toContain(
      'no note for it to join',
    )
  })

  // <voice> is optional on a chord member: it belongs to whatever voice the
  // note it joins belongs to.
  test('takes the voice of the note it joins when it states none', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
          '<duration>4</duration></note>',
      ),
    )
    const first = result?.sequences[0]?.content[0]

    expect(result?.sequences).toHaveLength(1)
    expect(first?.kind === 'event' && first.notes.map((n) => n.pitch.step)).toEqual(['C', 'E'])
  })

  test('rejects a rest marked as part of a chord', () => {
    expect(
      readFailure(measure(note('C', 1) + '<note><chord/><rest/><duration>4</duration></note>'))
        .message,
    ).toContain('rest cannot be part of a chord')
  })

  // A note joining a rest is the same contradiction the other way round: the
  // event it joins sounds nothing, so the note has no chord to be part of.
  test('rejects a note marked as part of a chord on a rest', () => {
    expect(
      readFailure(
        measure(
          '<note><rest/><duration>4</duration><voice>1</voice></note>' +
            note('E', 1, '1', '<chord/>'),
        ),
      ).message,
    ).toContain('rest cannot be part of a chord')
  })

  test('rejects chord notes that disagree about how long they last', () => {
    expect(readFailure(measure(note('C', 1) + note('E', 2, '1', '<chord/>'))).message).toContain(
      'lasts',
    )
  })

  // Sibelius writes some chord members with a duration that dropped the dot
  // both notes are written with. Where the written values agree the chord is
  // coherent: the written value is the one converted, and the duration is
  // reported.
  test('carries a chord member whose duration disagrees but whose written value matches', () => {
    const { measure: result, warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch>' +
          '<duration>12</duration><voice>1</voice><type>half</type><dot/></note>' +
          '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
          '<duration>8</duration><voice>1</voice><type>half</type><dot/></note>',
      ),
    )
    const first = result?.sequences[0]?.content[0]

    expect(first?.kind === 'event' && first.notes.map((n) => n.pitch.step)).toEqual(['C', 'E'])
    expect(first?.kind === 'event' && first.value).toEqual({ base: 'half', dots: 1 })
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:duration'])
  })

  // The written values agree on the note but not on its dots, which is a
  // disagreement like any other: the member is not the value the chord is
  // written as, so its duration is the one weighed against the chord's.
  test('rejects a chord member written with the same note but fewer dots', () => {
    expect(
      readFailure(
        measure(
          '<note><pitch><step>C</step><octave>4</octave></pitch>' +
            '<duration>12</duration><voice>1</voice><type>half</type><dot/></note>' +
            '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
            '<duration>8</duration><voice>1</voice><type>half</type></note>',
        ),
      ).message,
    ).toContain('lasts a different time from the chord')
  })

  test('rejects a chord member whose duration and written value both disagree', () => {
    expect(
      readFailure(
        measure(
          '<note><pitch><step>C</step><octave>4</octave></pitch>' +
            '<duration>8</duration><voice>1</voice><type>half</type></note>' +
            '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
            '<duration>4</duration><voice>1</voice><type>quarter</type></note>',
        ),
      ).message,
    ).toContain('lasts a different time from the chord')
  })
})

// A grace note is drawn small beside the note it ornaments and takes no time
// of its own.
// What matters here is that it stays out of the cursor's path; what it
// converts to is covered in tuplets.test.ts.
describe('grace notes', () => {
  const GRACE =
    '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type>' +
    '<voice>1</voice></note>'

  test('does not take time from the measure', () => {
    const { measure: result } = read(
      measure(GRACE + note('C', 1) + '<backup><duration>4</duration></backup>' + note('G', 1, '2')),
    )

    // Voice 2 starts where voice 1 did, so no space stands before it.
    expect(result?.sequences[1]?.content[0]?.kind).toBe('event')
  })

  test('stands beside the note it leads to rather than in the cursor', () => {
    const { measure: result } = read(measure(GRACE + note('C', 1)))
    const content = result?.sequences[0]?.content

    expect(content?.map((item) => item.kind)).toEqual(['grace', 'event'])
    // The event that follows is the real note, at its full value.
    expect(content?.[1]?.kind === 'event' && content[1].notes[0]?.pitch.step).toBe('C')
  })

  // The grace note is the last thing written, so no note after it settles
  // where the voice starts.
  test('is written at the measure start after a backup reaching past it', () => {
    const { measure: result, warnings } = read(
      measure(
        note('C', 4) +
          '<backup><duration>20</duration></backup>' +
          GRACE.replace('<voice>1</voice>', '<voice>2</voice>'),
      ),
    )

    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['grace'])
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
  })
})

// A grace note carries no <duration>, so where it states no <type> nothing
// says how long it is drawn. MNX states a value for every event, and the
// beams over the note are what draw it: one beam for an eighth, one more for
// each halving. Older encodings of the Beethoven quartets are written this
// way throughout.
describe('a grace note stating no <type>', () => {
  const graceNote = (body = '') =>
    `<note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice>${body}</note>`

  const valueOf = (result: ReturnType<typeof read>['measure']) => {
    const item = result?.sequences[0]?.content[0]
    return item?.kind === 'grace' ? item.content[0]?.value : undefined
  }

  test('draws it as an eighth where no beam says otherwise', () => {
    const { measure: result, warnings } = read(measure(graceNote() + note('C', 1)))

    expect(valueOf(result)).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings.map((w) => w.code)).toEqual(['missing:note-type'])
  })

  test('takes the value the beams over it draw', () => {
    const beams = '<beam number="1">begin</beam><beam number="2">begin</beam>'
    const { measure: result, warnings } = read(
      measure(graceNote(beams) + graceNote('<beam number="1">end</beam>') + note('C', 1)),
    )

    expect(valueOf(result)).toEqual({ base: '16th', dots: 0 })
    expect(warnings.map((w) => w.code)).toEqual(['missing:note-type', 'missing:note-type'])
  })

  // <beam> states no number for the first level, which is where a beam over
  // a grace note is usually drawn.
  test('reads a beam that states no level as the first one', () => {
    const { measure: result } = read(
      measure(graceNote('<beam>begin</beam>') + graceNote('<beam>end</beam>') + note('C', 1)),
    )

    expect(valueOf(result)).toEqual({ base: 'eighth', dots: 0 })
  })

  // Eight beams is as many as a stem carries.
  test('takes the deepest level a stem can carry', () => {
    const { measure: result } = read(
      measure(graceNote('<beam number="8">begin</beam>') + note('C', 1)),
    )

    expect(valueOf(result)).toEqual({ base: '1024th', dots: 0 })
  })

  // A level no stem carries, or one that is not a whole number, draws nothing,
  // so the note falls back to the eighth a grace note is drawn as.
  test.each([
    ['past the deepest a stem carries', '9'],
    ['that is not a whole number', '1.5'],
    ['written in hexadecimal', '0x2'],
    ['written with an exponent', '2e0'],
    ['below the first', '0'],
  ])('ignores a beam level %s', (_name, level) => {
    const { measure: result, warnings } = read(
      measure(graceNote(`<beam number="${level}">begin</beam>`) + note('C', 1)),
    )

    expect(valueOf(result)).toEqual({ base: 'eighth', dots: 0 })
    expect(warnings[0]?.message).toContain('which is how a grace note is drawn')
  })

  test('says which value it converted, and that a grace note is drawn that way', () => {
    const { warnings } = read(measure(graceNote() + note('C', 1)))

    expect(warnings[0]?.message).toContain('an eighth')
    expect(warnings[0]?.message).toContain('which is how a grace note is drawn')
  })

  test('says the beams drew the value where one beam is all there is', () => {
    const { warnings } = read(measure(graceNote('<beam number="1">begin</beam>') + note('C', 1)))

    expect(warnings[0]?.message).toContain('an eighth, which its beams draw')
  })

  // A note that is not a grace note has a <duration> to measure its value
  // from, and one stating neither is the source leaving out both.
  test('leaves a note stating neither a type nor a duration refused', () => {
    expect(
      readFailure(
        measure('<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice></note>'),
      ).message,
    ).toContain('states neither a <type> nor a <duration>')
  })

  test('converts to MNX the schema accepts', () => {
    convertValid(measure(graceNote() + note('C', 1)))
  })
})

// MusicXML says how much time a grace note steals and from which side; MNX
// states the side on the group and no amount.
describe('where a grace group takes its time from', () => {
  const graceNote = (attributes: string, step = 'D', beam = '') =>
    `<note><grace ${attributes}/><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<type>eighth</type><voice>1</voice>${beam}</note>`

  const groupOf = (result: ReturnType<typeof read>['measure']) => {
    const item = result?.sequences[0]?.content[0]
    return item?.kind === 'grace' ? item : undefined
  }

  test.each([
    ['steal-time-previous="20"', 'stealPrevious'],
    ['steal-time-following="33"', 'stealFollowing'],
    ['make-time="4"', 'makeTime'],
  ])('reads %s as %s', (attributes, expected) => {
    const { measure: result, warnings } = read(measure(graceNote(attributes) + note('C', 1)))

    expect(groupOf(result)?.graceType).toBe(expected)
    // The side carries over; the amount does not, and says so.
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:grace-time'])
  })

  test('states none where the source says nothing', () => {
    const { measure: result, warnings } = read(measure(graceNote('') + note('C', 1)))

    expect(groupOf(result)?.graceType).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('reports a note naming both sides, keeping the first', () => {
    const { measure: result, warnings } = read(
      measure(graceNote('steal-time-previous="20" steal-time-following="20"') + note('C', 1)),
    )

    expect(groupOf(result)?.graceType).toBe('stealPrevious')
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('states steal-time-previous="20"'),
      expect.stringContaining('names steal-time-following as well as another side'),
    ])
  })

  // An after-grace and the grace notes leading into the next note are both
  // written as a run of <grace> between the two, and only the side each takes
  // its time from tells them apart.
  test('cuts the run where the side changes', () => {
    const { measure: result } = read(
      measure(
        graceNote('steal-time-previous="20"') +
          graceNote('steal-time-following="20"', 'E') +
          graceNote('', 'F') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => [group.graceType, group.content.length])).toEqual([
      ['stealPrevious', 1],
      ['stealFollowing', 2],
    ])
  })

  // Each group beams within itself, so cutting the run under a beam would
  // leave one note at each end and drop the beam. The beam is what the
  // engraver drew; the side is playback.
  test('keeps a beam drawn across the change of side, and reports the side', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('steal-time-following="20"', 'E', '<beam number="1">end</beam>') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => [group.graceType, group.content.length])).toEqual([
      ['stealPrevious', 2],
    ])
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('states steal-time-previous="20"'),
      expect.stringContaining('states steal-time-following="20"'),
      expect.stringContaining('beamed to'),
    ])
  })

  // A note beamed into the group that restates the side it already takes says
  // nothing the group does not, so only the amount is reported.
  test('says nothing where a note beamed into the group restates its side', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('steal-time-previous="20"', 'E', '<beam number="1">end</beam>') +
          note('C', 1),
      ),
    )

    expect(groupOf(result)?.graceType).toBe('stealPrevious')
    expect(groupOf(result)?.content).toHaveLength(2)
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('states steal-time-previous="20"'),
      expect.stringContaining('states steal-time-previous="20"'),
    ])
  })

  test('keeps a note stating no side in the group it is beamed to', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('', 'E', '<beam number="1">end</beam>') +
          note('C', 1),
      ),
    )

    expect(groupOf(result)?.graceType).toBe('stealPrevious')
    expect(groupOf(result)?.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:grace-time'])
  })

  test('takes the side from a note beamed into a group that states none', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('', 'D', '<beam number="1">begin</beam>') +
          graceNote('make-time="4"', 'E', '<beam number="1">end</beam>') +
          note('C', 1),
      ),
    )

    expect(groupOf(result)?.graceType).toBe('makeTime')
    expect(groupOf(result)?.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:grace-time'])
  })

  // Exporters indent the text inside a <beam>.
  test('reads a beam whose text is written across lines', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('steal-time-following="20"', 'E', '<beam number="1">\n  end\n</beam>') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => [group.graceType, group.content.length])).toEqual([
      ['stealPrevious', 2],
    ])
    expect(warnings.map((w) => w.message)).toContainEqual(expect.stringContaining('beamed to'))
  })

  // The first beam is the one that joins notes, so a deeper level on its own
  // says nothing about the group the note stands in.
  test('reads the first beam level as what joins a note to the group', () => {
    const { measure: result } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('steal-time-following="20"', 'E', '<beam number="2">end</beam>') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => group.graceType)).toEqual(['stealPrevious', 'stealFollowing'])
  })

  // A beam is what says a note is beamed to the one before it, so another
  // child whose text happens to read "end" is not one.
  test('reads only a beam as joining a note to the group', () => {
    const { measure: result } = read(
      measure(
        graceNote('steal-time-previous="20"') +
          graceNote('steal-time-following="20"', 'E', '<footnote>end</footnote>') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => group.graceType)).toEqual(['stealPrevious', 'stealFollowing'])
  })

  test('cuts the run where the beam does not reach across it', () => {
    const { measure: result } = read(
      measure(
        graceNote('steal-time-previous="20"', 'D', '<beam number="1">begin</beam>') +
          graceNote('steal-time-following="20"', 'E', '<beam number="1">begin</beam>') +
          note('C', 1),
      ),
    )

    const groups = result?.sequences[0]?.content.filter((item) => item.kind === 'grace')
    expect(groups?.map((group) => group.graceType)).toEqual(['stealPrevious', 'stealFollowing'])
  })

  test('takes the side from a later member where the group states none', () => {
    const { measure: result } = read(
      measure(graceNote('') + graceNote('make-time="4"', 'E') + note('C', 1)),
    )

    expect(groupOf(result)?.graceType).toBe('makeTime')
    expect(groupOf(result)?.content).toHaveLength(2)
  })

  const chordMember = (attributes: string) =>
    `<note><chord/><grace ${attributes}/><pitch><step>F</step><octave>4</octave></pitch>` +
    '<type>eighth</type><voice>1</voice></note>'

  test('reads the side from the note that opens a chord, not its members', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-following="20"') +
          chordMember('steal-time-following="20"') +
          note('C', 1),
      ),
    )

    expect(groupOf(result)?.graceType).toBe('stealFollowing')
    // The member restates the side the chord already takes, so it says
    // nothing new and the amount is reported once.
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:grace-time'])
  })

  // The chord takes the side of the note that opens it, and a chord opening
  // with none takes whatever a member states rather than disagreeing with it.
  test('says nothing where a member states a side the chord opened with none', () => {
    const { measure: result, warnings } = read(
      measure(graceNote('') + chordMember('steal-time-previous="20"') + note('C', 1)),
    )

    expect(groupOf(result)?.graceType).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual([])
  })

  test('reports a chord member naming a side the chord does not take', () => {
    const { measure: result, warnings } = read(
      measure(
        graceNote('steal-time-following="20"') +
          chordMember('steal-time-previous="99"') +
          note('C', 1),
      ),
    )

    expect(groupOf(result)?.graceType).toBe('stealFollowing')
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:grace-time',
      'inconsistent:grace-time',
    ])
  })

  // The member's own attributes are read so that restating the group's is not
  // reported; the rest of its <grace> is still swept.
  test('reports an unread attribute on a chord member grace', () => {
    const { warnings } = read(
      measure(graceNote('') + chordMember('color="#FF0000"') + note('C', 1)),
    )

    expect(warnings.map((w) => [w.code, w.attribute])).toEqual([['unsupported:attribute', 'color']])
  })
})

describe('rests filling the measure', () => {
  const measureRest = (quarters: number, voice = '1') =>
    `<note><rest measure="yes"/><duration>${String(quarters * 4)}</duration>` +
    `<voice>${voice}</voice></note>`

  test('rejects a voice holding both a measure rest and notes', () => {
    expect(readFailure(measure(measureRest(1) + note('C', 1))).message).toContain(
      'fills the measure',
    )
  })

  test('rejects a second measure rest in the same voice', () => {
    expect(readFailure(measure(measureRest(1) + measureRest(1))).message).toContain(
      'fills the measure',
    )
  })

  test('lets each voice have its own measure rest', () => {
    const { measure: result } = read(
      measure(
        '<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>' +
          '<backup><duration>4</duration></backup>' +
          '<note><rest measure="yes"/><duration>4</duration><voice>2</voice></note>',
      ),
    )

    expect(result?.sequences.map((s) => s.fullMeasure !== undefined)).toEqual([true, true])
  })

  test('warns when a note without a voice appears beside voiced notes', () => {
    const { measure: result, warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note>' +
          '<backup><duration>16</duration></backup>' +
          note('E', 4, '1'),
      ),
    )

    expect(result?.sequences).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toContain('missing:voice')
  })

  test('does not warn when every note in the measure omits its voice', () => {
    const { measure: result, warnings } = read(
      measure(
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note>',
      ),
    )

    expect(result?.sequences).toHaveLength(1)
    expect(warnings.map((w) => w.code)).not.toContain('missing:voice')
  })
})

describe('the measure cursor', () => {
  test('fills the gap when a voice starts partway through the measure', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('G', 1, '2')),
    )
    const first = result?.sequences[1]?.content[0]

    expect(first?.kind).toBe('space')
    expect(first?.kind === 'space' && first.duration).toEqual(fraction(1, 4))
  })

  // A <backup> reaching past the start is held rather than reported, because a
  // <forward> can bring the cursor back: one that brings it back to the start
  // leaves nothing written out there and nothing to report.
  test('says nothing where a forward cancels a backup that reached past the start', () => {
    const { measure: result, warnings } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>8</duration></backup>' +
          '<forward><duration>4</duration></forward>' +
          note('E', 1, '2'),
      ),
    )

    expect(warnings).toEqual([])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['event'])
  })

  // A reach the cursor comes back from is forgotten, so a later reach is the
  // one reported, at the <backup> that made it. Each element is on its own
  // line, so the line in the report says which.
  test('reports the backup that last reached past the start', () => {
    const { warnings } = read(
      '<score-partwise><part id="P1"><measure number="1">' +
        `${DIVISIONS}\n${note('C', 1, '1')}` +
        '\n<backup><duration>8</duration></backup>' +
        '\n<forward><duration>4</duration></forward>' +
        '\n<backup><duration>4</duration></backup>' +
        `\n${note('E', 1, '2')}` +
        '\n</measure></part></score-partwise>',
    )

    expect(warnings.map((w) => [w.code, w.context.line])).toEqual([['inconsistent:backup', 5]])
  })

  test('treats forward as a gap in the voice it lands in', () => {
    const { measure: result } = read(
      measure('<forward><duration>4</duration></forward>' + note('C', 1)),
    )
    const content = result?.sequences[0]?.content

    expect(content?.[0]?.kind).toBe('space')
    expect(content).toHaveLength(2)
  })

  // Exporters return to the start of a measure a voice has not filled by
  // backing up the whole measure's length, whatever that voice wrote. Taking
  // the cursor to the start is what such a source means, and the document
  // used to be refused over it.
  test('takes a backup past the start of the measure to the start', () => {
    const { measure: result, warnings } = read(
      measure(note('C', 1, '1') + '<backup><duration>16</duration></backup>' + note('G', 2, '2')),
    )

    // Voice 2 begins at the measure start, so it holds its note and no space
    // before it.
    const second = result?.sequences[1]?.content
    expect(second?.[0]?.kind).toBe('event')
    expect(second).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
    expect(warnings[0]?.element).toBe('backup')
  })

  // A source reaches back past the measure start and forwards the same
  // distance to return. Nothing is written outside the measure, so the two
  // cancel and the notes written after them stand where the source drew them.
  // Nothing was written at the start either, so there is nothing to report.
  test('lets a forward cancel a backup that reached past the start', () => {
    const { measure: result, warnings } = read(
      measure(
        '<backup><duration>16</duration></backup>' +
          '<forward><duration>16</duration></forward>' +
          note('C', 1, '1'),
      ),
    )
    const content = result?.sequences[0]?.content

    expect(content?.map((item) => item.kind)).toEqual(['event'])
    expect(warnings).toEqual([])
  })

  // The reach is one event however many moves the source takes to return
  // from it, and the <backup> is what reached, so that is the line reported.
  test('reports a reach past the start once, against the backup', () => {
    const { warnings } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>16</duration></backup>' +
          '<forward><duration>4</duration></forward>' +
          '<forward><duration>4</duration></forward>' +
          note('G', 1, '2'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
    expect(warnings[0]?.element).toBe('backup')
  })

  test.each(['backup', 'forward'])('rejects a <%s> that states no duration', (name) => {
    expect(readFailure(measure(note('C', 1) + `<${name}/>`)).message).toContain('states no')
  })

  test('reports what it does not convert inside a backup or forward', () => {
    const { warnings } = read(
      measure(note('C', 1) + '<backup><duration>4</duration><staff>2</staff></backup>'),
    )

    expect(warnings.map((w) => w.message)).toContain('<staff> is not converted yet.')
  })

  test('lays a note over what its voice already wrote in a second sequence', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )

    expect(result?.sequences).toHaveLength(2)
    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['space', 'event'])
  })

  test('spaces the laid-over sequence out to where it begins', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )

    const first = result?.sequences[1]?.content[0]
    expect(first?.kind === 'space' && first.duration).toEqual(fraction(1, 4))
  })

  // MNX lets no two sequences of a measure share a voice name, and naming a
  // laid-over line after the voice it was written in would claim two lines
  // are one.
  test('names the laid-over sequence after the voice and the line it is', () => {
    const { measure: result } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )

    expect(result?.sequences.map((s) => s.voice)).toEqual(['1', '1.2'])
  })

  // Two voices splitting in one measure used to leave two sequences with no
  // name, which nothing can tell apart.
  test('gives every sequence of a measure a name of its own', () => {
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>8</duration></backup>' +
          note('E', 1, '1') +
          '<backup><duration>4</duration></backup>' +
          note('G', 2, '2') +
          '<backup><duration>8</duration></backup>' +
          note('B', 1, '2'),
      ),
    )
    const named = result?.sequences.map((s) => s.voice) ?? []

    expect(named).toEqual(['1', '1.2', '2', '2.2'])
    expect(new Set(named).size).toBe(named.length)
  })

  // A name the measure already uses is stepped past, so the source naming a
  // voice "1.2" does not collide with the line laid over voice 1.
  test('steps past a name the measure already uses', () => {
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>4</duration></backup>' +
          note('E', 1, '1') +
          note('G', 1, '1.2'),
      ),
    )

    expect(result?.sequences.map((s) => s.voice)).toEqual(['1', '1.3', '1.2'])
  })

  // A run written as one run stays in one sequence. Sending it back to the
  // first sequence the moment that one has room would split a beam, a
  // bracket or a chord between two sequences, which is to draw neither.
  test('keeps writing in the sequence the voice last sounded in', () => {
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>4</duration></backup>' +
          note('E', 1, '1') +
          note('G', 2, '1'),
      ),
    )

    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual([
      'space',
      'event',
      'event',
    ])
  })

  // Where it has no room, the first sequence that has takes the note, so a
  // voice opens no more sequences than the music laid over it needs.
  test('takes the first sequence with room where the last one has none', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>4</duration></backup>' +
          note('E', 2, '1') +
          '<backup><duration>4</duration></backup>' +
          note('G', 1, '1'),
      ),
    )

    expect(result?.sequences).toHaveLength(2)
    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual(['event', 'event'])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['event'])
  })

  test('opens a third sequence where two are already sounding', () => {
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>8</duration></backup>' +
          note('E', 2, '1') +
          '<backup><duration>8</duration></backup>' +
          note('G', 2, '1'),
      ),
    )

    expect(result?.sequences).toHaveLength(3)
  })

  // The report has to name a line, and the note that opened the second
  // sequence is the one the source wrote.
  test('reports the split at the note that opened the second sequence', () => {
    const { warnings } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )

    expect(warnings.find((w) => w.code === 'inconsistent:voice')?.context.line).toBeDefined()
  })

  test('reports a voice sounding two notes at once, naming it', () => {
    const { warnings } = read(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )

    expect(warnings.map((w) => w.code)).toContain('inconsistent:voice')
    expect(warnings.find((w) => w.code === 'inconsistent:voice')?.message).toContain(
      'Voice 1 sounds 2 lines',
    )
  })

  // Notes that name no voice are one line of their own, and lay over each
  // other the same way. The report has no name to give, so it says so.
  test('names the unnamed voice in the report', () => {
    const bare = (step: string, quarters: number) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>${String(quarters * 4)}</duration></note>`
    const { warnings } = read(
      measure(bare('C', 2) + '<backup><duration>4</duration></backup>' + bare('E', 1)),
    )

    expect(warnings.map((w) => w.message)).toContainEqual(
      expect.stringContaining('Voice (unnamed) sounds 2 lines at once'),
    )
  })

  // A beam, a bracket and a grace note all belong to one line. Settling the
  // sequence only once the note is written left them reaching for the line
  // the voice sounded in before, which is a different line.
  test('keeps a beam over a laid-over line whole', () => {
    const eighth = (step: string, beam = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration>` +
      `<voice>1</voice><type>eighth</type>${beam}</note>`
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>4</duration></backup>' +
          eighth('D') +
          eighth('E', '<beam number="1">begin</beam>') +
          eighth('F', '<beam number="1">end</beam>'),
      ),
    )

    expect(result?.beams).toHaveLength(1)
    expect(result?.beams[0]?.events).toHaveLength(2)
  })

  test('ornaments the note a grace note was written against, in its line', () => {
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>8</duration></backup>' +
          '<note><grace/><pitch><step>B</step><octave>4</octave></pitch>' +
          '<voice>1</voice><type>eighth</type></note>' +
          note('D', 1, '1'),
      ),
    )

    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual(['event'])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['grace', 'event'])
  })

  test('writes the gap before a grace group carried into another line', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>4</duration></backup>' +
          note('D', 2, '1') +
          '<backup><duration>2</duration></backup>' +
          '<note><grace/><pitch><step>B</step><octave>4</octave></pitch>' +
          '<voice>1</voice><type>eighth</type></note>' +
          note('E', 0.5, '1'),
      ),
    )

    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual([
      'event',
      'space',
      'grace',
      'event',
    ])
  })

  // The beams over a grace group move with it, so the group is beamed once, in
  // the line it ends up in, rather than twice or not at all.
  test('carries the beams over a grace group into the line it moves to', () => {
    const graced = (step: string, marker: string) =>
      `<note><grace/><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<voice>1</voice><type>eighth</type><beam number="1">${marker}</beam></note>`
    const { measure: result } = read(
      measure(
        note('C', 2, '1') +
          '<backup><duration>8</duration></backup>' +
          graced('A', 'begin') +
          graced('B', 'end') +
          note('D', 1, '1'),
      ),
    )

    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['grace', 'event'])
    expect(result?.beams).toHaveLength(1)
    expect(result?.beams[0]?.events).toHaveLength(2)
  })

  // A group taking its time from the note before it is drawn after that
  // note, so it stays in that note's sequence rather than following the one
  // that comes next.
  test('leaves an after-grace group in the sequence of the note it follows', () => {
    const { measure: result } = read(
      measure(
        note('C', 1, '1') +
          '<backup><duration>4</duration></backup>' +
          note('E', 2, '1') +
          '<backup><duration>4</duration></backup>' +
          '<note><grace steal-time-previous="50"/><pitch><step>B</step><octave>4</octave></pitch>' +
          '<voice>1</voice><type>eighth</type></note>' +
          note('D', 1, '1'),
      ),
    )

    expect(result?.sequences[0]?.content.map((item) => item.kind)).toEqual(['event', 'event'])
    expect(result?.sequences[1]?.content.map((item) => item.kind)).toEqual(['event', 'grace'])
  })

  test('converts a laid-over voice to MNX the schema accepts', () => {
    convertValid(
      measure(note('C', 2, '1') + '<backup><duration>4</duration></backup>' + note('E', 1, '1')),
    )
  })
})

// MNX states a rest that fills the measure on the sequence rather than as an
// event, so a voice cannot hold both. The two ways that happens are different
// mistakes, and used to share a message that named only one of them. Each
// rest here states no value it is drawn as: one that does can stand as an
// ordinary rest instead, and is read as one.
describe('a rest filling a measure that already holds something', () => {
  test('names the notes it clashes with, not a second rest', () => {
    let thrown = ''
    try {
      read(
        measure(
          note('C', 1) +
            '<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('both a rest that fills the measure and notes in it')
  })

  test('still names a second rest as one', () => {
    let thrown = ''
    try {
      read(
        measure(
          '<note><rest measure="yes"/><duration>16</duration></note>' +
            '<backup><duration>16</duration></backup>' +
            '<note><rest measure="yes"/><duration>16</duration></note>',
        ),
      )
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }

    expect(thrown).toContain('more than one rest that fills the measure')
  })

  // A tuplet counts in note values, so the bracket is opened by the note
  // before the rest rather than by the rest itself.
  const tuplet =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type>' +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification><notations><tuplet type="start"/></notations></note>'

  // A bracket around such a rest is a third mistake again: the rest is stated
  // on the sequence, where a tuplet cannot reach it. The refusal used to
  // describe notes that are not there.
  test('names the bracket around it, not notes it does not hold', () => {
    const rest = '<note><rest measure="yes"/><duration>16</duration></note>'

    expect(readFailure(measure(tuplet + rest)).message).toContain('<tuplet>')
  })

  // A tremolo gathers the two notes it holds, and a rest stated on the
  // sequence is not one of them.
  test('names a tremolo open around it', () => {
    const rest =
      '<note><rest measure="yes"/><duration>16</duration>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'

    // Named in full: a tremolo left open at the end of the measure refuses
    // too, and that message also holds the word "tremolo".
    expect(readFailure(measure(rest)).message).toContain(
      'A rest that fills the measure is inside a two-note tremolo.',
    )
  })

  // With two brackets open, the innermost is the one that cannot hold the
  // rest, and the one the refusal names. Every fixture above opens one, so
  // nothing said which of several is picked.
  test('names the innermost of two brackets open around it', () => {
    const tremolo =
      '<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration>' +
      '<type>quarter</type>' +
      '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
      '</time-modification>' +
      '<notations><ornaments><tremolo type="start">3</tremolo></ornaments></notations></note>'
    const rest = '<note><rest measure="yes"/><duration>16</duration></note>'

    expect(readFailure(measure(tuplet + tremolo + rest)).message).toContain(
      'A rest that fills the measure is inside a two-note tremolo.',
    )
  })
})
