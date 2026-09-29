// What each reader passes over is reported, whichever path it took. The
// exceptions below are accounted for elsewhere and are not reported.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'

function measure(body: string, attributes = '<divisions>4</divisions>'): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    `<attributes>${attributes}</attributes>` +
    `${body}</measure></part></score-partwise>`
  )
}

function note(body: string, step = 'C'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><type>quarter</type>${body}</note>`
  )
}

/** The elements reported as unconverted, in the order they were found. */
function lost(source: string): string[] {
  const warnings = new WarningCollector()
  readValid(source, warnings)
  return warnings
    .list()
    .map((warning) => /<([a-z-]+)>/.exec(warning.message)?.[1])
    .filter((name): name is string => name !== undefined)
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readValid(source, warnings)
  return { score, warnings: warnings.list() }
}

describe('a note that joins the chord before it', () => {
  const chord = (body: string) =>
    measure(
      note('') +
        `<note><chord/><pitch><step>E</step><octave>4</octave></pitch>` +
        `<duration>4</duration><type>quarter</type>${body}</note>`,
    )

  test('reports the words under it, which are not carried over', () => {
    expect(lost(chord('<lyric number="1"><text>lost</text></lyric>'))).toEqual(['lyric'])
  })

  test('reports a slur starting on it, which is not carried over', () => {
    expect(lost(chord('<notations><slur type="start" number="1"/></notations>'))).toContain('slur')
  })

  test('says nothing about its stem or beams, which are the chord it joins', () => {
    expect(lost(chord('<stem>up</stem><beam number="1">begin</beam>'))).toEqual([])
  })

  // Every note of a grace chord restates the group's <grace>; the slash is
  // carried from the group's first note, so a member's restatement is not a
  // loss.
  test('says nothing about the grace slash it restates', () => {
    const graceChord = measure(
      '<note><grace slash="yes"/><pitch><step>C</step><octave>4</octave></pitch>' +
        '<type>eighth</type></note>' +
        '<note><chord/><grace slash="yes"/><pitch><step>E</step><octave>4</octave></pitch>' +
        '<type>eighth</type></note>' +
        note(''),
    )

    expect(lost(graceChord)).toEqual([])
  })

  test('says nothing about the ratio it repeats, which is the chord it joins', () => {
    expect(
      lost(
        chord(
          '<time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification>',
        ),
      ),
    ).toEqual([])
  })
})

describe('a chord member naming a staff', () => {
  const twoStaves = '<divisions>4</divisions><staves>2</staves>'
  const chord = (headStaff: string, memberStaff: string) =>
    measure(
      note(`<staff>${headStaff}</staff>`) +
        '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>' +
        `<type>quarter</type><staff>${memberStaff}</staff></note>`,
      twoStaves,
    )

  // MNX states the staff on the event, so the chord's own staff carries it.
  test('says nothing when it is the staff the chord is already on', () => {
    expect(lost(chord('1', '1'))).toEqual([])
  })

  // MNX states the staff on the note as well, so a chord straddling the two
  // hands is carried whole and there is nothing to report.
  test('says nothing when it reaches across to the other staff', () => {
    expect(lost(chord('1', '2'))).toEqual([])
  })
})

describe('a grace note', () => {
  const grace = (body: string) =>
    measure(
      `<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type>` +
        `${body}</note>` +
        note(''),
    )

  test('says nothing about its beams, which are carried over', () => {
    expect(lost(grace('<beam number="1">begin</beam>'))).toEqual([])
  })

  test('says nothing about the words under it, which are carried over', () => {
    expect(lost(grace('<lyric number="1"><text>kept</text></lyric>'))).toEqual([])
  })
})

describe('a beam', () => {
  // A fanned beam (accelerando or ritardando) has no home in the schema, and
  // <beam> has no children for the unread sweep to catch, so the fan is
  // reported explicitly.
  test('reports the fan on it, which is not carried over', () => {
    expect(
      lost(
        measure(
          note('<beam number="1" fan="accel">begin</beam>') +
            note('<beam number="1">end</beam>', 'D'),
        ),
      ),
    ).toEqual(['beam'])
  })

  // "none" is MusicXML's default.
  test('says nothing about a beam fanned as "none", which draws the plain beam', () => {
    expect(
      lost(
        measure(
          note('<beam number="1" fan="none">begin</beam>') +
            note('<beam number="1">end</beam>', 'D'),
        ),
      ),
    ).toEqual([])
  })

  test('says nothing about a plain beam, which is carried over', () => {
    expect(
      lost(
        measure(note('<beam number="1">begin</beam>') + note('<beam number="1">end</beam>', 'D')),
      ),
    ).toEqual([])
  })
})

// Where an element is drawn is presentation, not notation.
test('reports nothing for the attributes that place an element', () => {
  const placed = note('').replace(
    '<note>',
    '<note default-x="10" default-y="-20" relative-x="1" relative-y="2">',
  )

  expect(lost(measure(placed))).toEqual([])
})

describe('an element hidden with print-object="no"', () => {
  // MNX has no way to mark an element invisible, so a hidden one is drawn
  // anyway. The hiding is reported as a loss of the attribute on the element
  // that carries it.
  const hidden = (source: string) =>
    read(source)
      .warnings.filter((warning) => warning.attribute === 'print-object')
      .map((warning) => [warning.code, warning.element])

  test('reports a hidden note', () => {
    expect(hidden(measure(note('').replace('<note>', '<note print-object="no">')))).toEqual([
      ['unrepresentable:attribute', 'note'],
    ])
  })

  // A hidden rest is time with nothing drawn in it, which a space holds.
  test('reports a hidden rest as not converted yet', () => {
    expect(
      hidden(
        measure('<note print-object="no"><rest/><duration>4</duration><type>quarter</type></note>'),
      ),
    ).toEqual([['unsupported:attribute', 'note']])
  })

  test('reports a hidden time signature', () => {
    expect(
      hidden(
        measure(
          note(''),
          '<divisions>4</divisions><time print-object="no"><beats>4</beats><beat-type>4</beat-type></time>',
        ),
      ),
    ).toEqual([['unrepresentable:attribute', 'time']])
  })

  test('reports a hidden key signature', () => {
    expect(
      hidden(
        measure(
          note(''),
          '<divisions>4</divisions><key print-object="no"><fifths>2</fifths></key>',
        ),
      ),
    ).toEqual([['unrepresentable:attribute', 'key']])
  })

  test('reports a hidden ending', () => {
    expect(
      hidden(
        measure(
          note('') +
            '<barline location="right"><ending number="1" type="stop" print-object="no"/></barline>',
        ),
      ),
    ).toEqual([['unrepresentable:attribute', 'ending']])
  })

  test('reports a hidden notations block', () => {
    expect(hidden(measure(note('<notations print-object="no"><fermata/></notations>')))).toEqual([
      ['unrepresentable:attribute', 'notations'],
    ])
  })

  // An empty block hides nothing. The attribute is read, not left for the
  // sweep, which would report it as a loss.
  test('says nothing about an empty hidden notations block', () => {
    expect(read(measure(note('<notations print-object="no"/>'))).warnings).toEqual([])
  })

  test('says nothing about an element the source draws', () => {
    expect(hidden(measure(note('')))).toHaveLength(0)
  })

  test('says nothing about an element the source explicitly shows', () => {
    expect(
      hidden(
        measure(
          '<note print-object="yes"><rest/><duration>4</duration><type>quarter</type></note>',
        ),
      ),
    ).toHaveLength(0)
  })
})

describe('a direction', () => {
  const direction = (body: string) =>
    measure(
      note('') +
        `<direction><direction-type><dynamics><p/></dynamics></direction-type>${body}</direction>`,
    )

  test('says nothing about the offset that moves it, which is applied', () => {
    expect(lost(direction('<offset>2</offset>'))).toEqual([])
  })

  test('reports a bare <sound> tempo, which is playback the output cannot draw', () => {
    expect(lost(direction('<sound tempo="120"/>'))).toEqual(['sound'])
  })

  test('reports the playback a <sound> carries beyond the tempo', () => {
    expect(lost(direction('<sound dynamics="71"/>'))).toEqual(['sound'])
  })

  test('says nothing about the staff it belongs to, which is carried over', () => {
    expect(lost(direction('<staff>1</staff>'))).toEqual([])
  })

  test('says nothing when it carries only what is converted', () => {
    expect(lost(direction(''))).toEqual([])
  })
})

describe('a rest placed on the staff', () => {
  // <display-step>/<display-octave> fix a rest's height, read against the clef
  // in force. Where the measure states no clef, it is reported. Converting it
  // where a clef is in force is tested in rests.test.ts.
  test('reports a display position it cannot place without a clef', () => {
    expect(
      lost(
        measure(
          '<note><rest><display-step>G</display-step><display-octave>4</display-octave></rest>' +
            '<duration>4</duration><type>quarter</type></note>',
        ),
      ),
    ).toEqual(['display-step'])
  })

  test('says nothing about a plain rest, which carries no position', () => {
    expect(lost(measure('<note><rest/><duration>4</duration><type>quarter</type></note>'))).toEqual(
      [],
    )
  })
})

describe('a rest that fills the measure', () => {
  const rest = (body: string, attributes?: string) =>
    measure(`<note><rest measure="yes"/><duration>16</duration>${body}</note>`, attributes)

  test('puts its voice on the staff the rest names', () => {
    const { score, warnings } = read(
      rest('<staff>2</staff>', '<divisions>4</divisions><staves>2</staves>'),
    )

    expect(score.parts[0]?.measures[0]?.sequences[0]?.staff).toBe(2)
    expect(warnings).toEqual([])
  })

  test('says nothing about a stem or a beam, which a rest is not drawn with', () => {
    expect(lost(rest('<stem>up</stem><beam number="1">begin</beam>'))).toEqual([])
  })

  // A word spoken over an otherwise resting bar is written as a lyric on the
  // whole-measure rest. MNX's sequence-level full-measure rest has no room for
  // one, but a plain rest event does, so the rest stays an event and the word
  // is kept.
  test('keeps a lyric written on it, which a full-measure rest cannot carry', () => {
    const { score, warnings } = read(rest('<lyric number="1"><text>Oh!</text></lyric>'))
    const sequence = score.parts[0]?.measures[0]?.sequences[0]
    const first = sequence?.content[0]

    expect(sequence?.fullMeasure).toBeUndefined()
    expect(first?.kind === 'event' && first.isRest).toBe(true)
    expect(first?.kind === 'event' && first.lyrics).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  // Where no note value can write the measure's length, the rest cannot become
  // an event. It stays a full-measure rest, and its lyric is reported.
  test('reports a lyric on a full-measure rest whose length no note value writes', () => {
    const { score, warnings } = read(
      measure(
        '<note><rest measure="yes"/><duration>10</duration>' +
          '<lyric number="1"><text>Oh!</text></lyric></note>',
        '<divisions>4</divisions><time><beats>5</beats><beat-type>8</beat-type></time>',
      ),
    )

    expect(score.parts[0]?.measures[0]?.sequences[0]?.fullMeasure).toBeDefined()
    expect(warnings.map((warning) => warning.element)).toContain('lyric')
  })
})

describe('a note stating both kinds of tie', () => {
  // <tied> is the visual counterpart of <tie>, which is what the tie is read
  // from, so a document stating both loses nothing by <tied> going unread.
  test('says nothing about <tied>, which <tie> already carried', () => {
    const source = measure(
      note('<tie type="start"/><notations><tied type="start"/></notations>') +
        note('<tie type="stop"/><notations><tied type="stop"/></notations>', 'D'),
    )

    expect(lost(source)).toEqual([])
  })
})

describe('a cursor move', () => {
  test('reports the voice it names, which the model cannot yet express', () => {
    const source = measure(note('') + '<backup><duration>4</duration><voice>1</voice></backup>')

    expect(lost(source)).toEqual(['voice'])
  })
})

// A loss the schema has no home for reads "cannot be expressed in MNX". A
// loss this converter does not convert yet reads "is not converted yet".
describe('a loss the schema has no home for', () => {
  const codes = (source: string) =>
    read(source).warnings.map((warning) => `${warning.code} ${warning.message}`)

  // <identification>'s one part with a home is <encoding><supports>. Its
  // accidental and beam declarations are the schema's support flags, which
  // the writer restates. The composer, the rights and the rest have no home.
  const identified = (body: string) =>
    `<score-partwise><identification>${body}</identification>` +
    '<part id="P1"><measure number="1">' +
    `<attributes><divisions>4</divisions></attributes>${note('')}</measure>` +
    '</part></score-partwise>'

  test('says nothing about an <identification> stating only the supports', () => {
    expect(
      codes(
        identified(
          '<encoding><supports element="accidental" type="yes"/>' +
            '<supports element="beam" type="yes"/></encoding>',
        ),
      ),
    ).toEqual([])
  })

  test('says nothing about an empty <identification>', () => {
    expect(codes(identified(''))).toEqual([])
  })

  test('reports the rest of <identification> as unrepresentable', () => {
    expect(codes(identified('<creator type="composer">Someone</creator>'))).toEqual([
      'unrepresentable:element <identification> cannot be expressed in MNX.',
    ])
  })

  test('counts an encoding note beside the supports as the rest', () => {
    expect(
      codes(
        identified(
          '<encoding><software>MuseScore</software>' +
            '<supports element="beam" type="yes"/></encoding>',
        ),
      ),
    ).toEqual(['unrepresentable:element <identification> cannot be expressed in MNX.'])
  })

  test('counts a supports declaration it cannot restate as the rest', () => {
    expect(
      codes(identified('<encoding><supports element="print" type="yes"/></encoding>')),
    ).toEqual(['unrepresentable:element <identification> cannot be expressed in MNX.'])
  })

  // A whole "yes" is the one declaration the support flags restate. A "no",
  // or one narrowed to an attribute, is a statement they cannot make, and
  // counts as the rest.
  test('counts a supports declaration of "no" as the rest', () => {
    expect(codes(identified('<encoding><supports element="beam" type="no"/></encoding>'))).toEqual([
      'unrepresentable:element <identification> cannot be expressed in MNX.',
    ])
  })

  test('counts a supports declaration narrowed to an attribute as the rest', () => {
    expect(
      codes(
        identified(
          '<encoding><supports element="accidental" attribute="cautionary" type="yes"/>' +
            '</encoding>',
        ),
      ),
    ).toEqual(['unrepresentable:element <identification> cannot be expressed in MNX.'])
  })

  // A boxed rehearsal mark. The schema's measure-global holds no label or
  // mark, and nothing else can carry one.
  test('reports <rehearsal> as unrepresentable', () => {
    expect(
      codes(
        measure(
          note('') +
            '<direction><direction-type><rehearsal>1</rehearsal></direction-type></direction>',
        ),
      ),
    ).toEqual(['unrepresentable:element A <rehearsal> direction cannot be expressed in MNX.'])
  })

  // The horizontal bracket line over a passage: the same construct as
  // <dashes> with a different line end, and the schema has no such line.
  test('reports <bracket> as unrepresentable', () => {
    expect(
      codes(
        measure(
          note('') +
            '<direction><direction-type><bracket type="start" line-end="down"/>' +
            '</direction-type></direction>',
        ),
      ),
    ).toEqual(['unrepresentable:element A <bracket> direction cannot be expressed in MNX.'])
  })

  // The schema's staff-config states a line count and nothing else.
  test('reports <staff-size> as unrepresentable', () => {
    expect(
      codes(
        measure(
          note(''),
          '<divisions>4</divisions><staff-details><staff-size>70</staff-size></staff-details>',
        ),
      ),
    ).toEqual(['unrepresentable:element <staff-size> cannot be expressed in MNX.'])
  })

  // A size is a percentage of the work's own scaling, so a hundred percent is
  // the staff MNX draws anyway. The value is a decimal, so a fraction of
  // nothing and a leading zero state the same hundred.
  test.each(['100', '100.0', '0100'])('says nothing about a staff sized %s', (written) => {
    expect(
      codes(
        measure(
          note(''),
          `<divisions>4</divisions><staff-details><staff-size>${written}</staff-size>` +
            '</staff-details>',
        ),
      ),
    ).toEqual([])
  })

  // Exponent notation is not a decimal, and is reported rather than read as
  // the hundred it would come to.
  test('reports a size written in exponent notation', () => {
    expect(
      codes(
        measure(
          note(''),
          '<divisions>4</divisions><staff-details><staff-size>1e2</staff-size></staff-details>',
        ),
      ),
    ).toEqual(['unrepresentable:element <staff-size> cannot be expressed in MNX.'])
  })

  // The scaling a size states beyond the staff itself is its own loss, and
  // stands whether or not the size is the default.
  test('reports the scaling of a default-sized staff', () => {
    expect(
      codes(
        measure(
          note(''),
          '<divisions>4</divisions><staff-details>' +
            '<staff-size scaling="80">100</staff-size></staff-details>',
        ),
      ),
    ).toEqual([
      'unsupported:attribute The "scaling" attribute of a <staff-size> is not converted yet.',
    ])
  })

  // A line count is converted into the measure's staffConfigs. MNX draws five
  // lines where no config names the staff, so a count of five writes nothing.
  test.each(['1', '5', '05'])('says nothing about a staff stated with %s lines', (written) => {
    expect(
      codes(
        measure(
          note(''),
          `<divisions>4</divisions><staff-details><staff-lines>${written}</staff-lines>` +
            '</staff-details>',
        ),
      ),
    ).toEqual([])
  })

  // Hiding a staff is score structure, and a layout omitting the staff can
  // state it, so the hiding is a converter gap rather than a format limit.
  test('reports hiding a staff as a gap, apart from the appearance', () => {
    expect(
      codes(
        measure(
          note(''),
          '<divisions>4</divisions>' +
            '<staff-details print-object="no" print-spacing="yes" number="1"/>',
        ),
      ),
    ).toEqual([
      'unsupported:element Hiding a staff with <staff-details print-object="no"> is not ' +
        'converted yet.',
    ])
  })

  // A hidden staff whose details also restyle it is two losses at once, and
  // each is reported on its own.
  test('reports a hidden restyled staff as both losses', () => {
    expect(
      codes(
        measure(
          note(''),
          '<divisions>4</divisions><staff-details print-object="no">' +
            '<staff-lines>3</staff-lines><staff-size>70</staff-size></staff-details>',
        ),
      ),
    ).toEqual([
      'unsupported:element Hiding a staff with <staff-details print-object="no"> is not ' +
        'converted yet.',
      'unrepresentable:element <staff-size> cannot be expressed in MNX.',
    ])
  })

  // An empty <staff-details> that names a staff states nothing about it, so
  // there is nothing to lose.
  test('says nothing about an empty <staff-details>', () => {
    expect(codes(measure(note(''), '<divisions>4</divisions><staff-details number="2"/>'))).toEqual(
      [],
    )
  })

  // Whether a direction prints on every system or only the top one of a page.
  // The schema's only visibility properties are an accidental's, a clef's
  // octave, a hidden clef, and a tuplet's number and value.
  test('reports a <direction> system attribute as unrepresentable', () => {
    expect(
      codes(
        measure(
          note('') +
            '<direction system="only-top"><direction-type><dynamics><p/></dynamics>' +
            '</direction-type></direction>',
        ),
      ),
    ).toEqual([
      'unrepresentable:attribute The "system" attribute of a <direction> cannot be expressed in MNX.',
    ])
  })
})

// The part list holds more than the names read from it.
describe('the part list', () => {
  test('reports what it holds besides the name, against the part it describes', () => {
    const warnings = new WarningCollector()
    readValid(
      '<score-partwise><part-list>' +
        '<part-group type="start"><group-symbol>brace</group-symbol></part-group>' +
        '<score-part id="P1"><part-name>Piano</part-name>' +
        '<part-abbreviation>Pno.</part-abbreviation></score-part>' +
        '</part-list>' +
        '<part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        note('') +
        '</measure></part></score-partwise>',
      warnings,
    )

    const reported = warnings.list()
    expect(reported.map((w) => w.element)).toEqual(['part-group'])
  })
})
