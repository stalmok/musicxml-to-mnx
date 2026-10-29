import { describe, expect, test } from 'vitest'
import { readFailure, readValid } from '../../tests/support/read.js'
import { NOTE, score } from '../../tests/support/musicxml.js'
import { convertValid } from '../../tests/support/convert.js'
import { MusicXMLError } from '../errors.js'
import { parseXmlRoot } from '../xml/parse.js'
import { timesInForce } from './signatures.js'
import { WarningCollector } from './collector.js'

function read(source: string) {
  const warnings = new WarningCollector()
  const result = readValid(source, warnings)
  return { score: result, warnings: warnings.list() }
}

// MNX states a time signature at the start of a measure only. MusicXML can
// state one at any point, and one stated after a measure's notes is how some
// sources write a change that takes effect at the next barline.
describe('a time signature stated after the measure start', () => {
  const timed = (beats: number) =>
    `<attributes><time><beats>${String(beats)}</beats><beat-type>4</beat-type></time></attributes>`
  const note = (duration: number | string, voice = 1) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><voice>${String(voice)}</voice></note>`
  const part = (...measures: string[]) =>
    score(
      '<part id="P1">' +
        measures
          .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
          .join('') +
        '</part>',
    )
  const opening = '<attributes><divisions>12</divisions></attributes>'

  test('takes effect at the next measure when stated after the notes', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test("is the next measure's own when the measure states none before it", () => {
    const { score: result, warnings } = read(part(opening + note(24) + timed(3), note(36)))

    expect(result.globalMeasures.map((m) => m.time)).toEqual([undefined, { count: 3, unit: 4 }])
    expect(warnings).toEqual([])
  })

  // A statement after a <backup> to the start stands where the measure
  // begins, so the notes written before it are measured against it too.
  test('measures the rests written before a statement at the start against it', () => {
    const rest = (voice: number) =>
      `<note><rest/><duration>36</duration><voice>${String(voice)}</voice><type>whole</type></note>`
    const second = (body: string) =>
      read(part(opening + timed(4) + note(48), body)).score.parts[0]?.measures[1]
    const before = second(rest(1) + back(36) + timed(3) + rest(2))
    const after = second(timed(3) + rest(1) + back(36) + rest(2))

    expect(before).toEqual(after)
  })

  test('adds nothing when it restates the time signature in force', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
    expect(warnings).toEqual([])
  })

  test('adds nothing when the next measure restates it', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), timed(3) + note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reports a change partway through a measure and converts it at the next', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + '\n' + timed(3) + note(12), note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        element: 'time',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  // A rest with no written value lasting the measure is the measure's rest.
  // One lasting the late time signature's length is not, since the measure
  // is still the one it opens with.
  test('measures a rest after it against the time signature the measure opens with', () => {
    const rest = (duration: number) =>
      `<note><rest/><duration>${String(duration)}</duration><voice>2</voice></note>`
    const { score: result, warnings } = read(
      part(
        opening +
          timed(4) +
          note(12) +
          timed(3) +
          note(36) +
          '<backup><duration>48</duration></backup>' +
          rest(36) +
          rest(12),
        note(36),
      ),
    )

    const resting = result.parts[0]?.measures[0]?.sequences[1]
    expect(resting?.fullMeasure).toBeUndefined()
    expect(resting?.content).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:mid-measure-time'])
  })

  // The cursor is back inside the measure, although every note in it is read.
  test('takes a statement after a <backup> into the measure as partway through', () => {
    const { warnings } = read(
      part(
        opening + timed(2) + note(24) + '<backup><duration>12</duration></backup>' + timed(3),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('carries a change of glyph alone to the next measure', () => {
    const common =
      '<attributes><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>' +
      '</attributes>'
    const { score: result } = read(part(opening + timed(4) + note(48) + common, note(48)))

    expect(result.globalMeasures[1]?.time).toEqual({ count: 4, unit: 4, display: 'common' })
  })

  test('reports a change partway through a measure when the next restates it', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(12), timed(3) + note(36)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one the next measure replaces with its own', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(24) + timed(3), timed(4) + note(48)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 4, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringMatching(
          /at the end of .* The next measure states its own, so it is not converted\.$/,
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one stated after the notes of the last measure', () => {
    const { warnings } = read(part(opening + timed(2) + note(24) + timed(3)))

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining(
          'This is the last measure of the part, so it is not converted.',
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one a later statement in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(12) + timed(4), note(48)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 4, unit: 4 },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining(
          'A later one in this measure replaces it, so it is not converted.',
        ),
      }),
    ])
  })

  test('does not carry one a later senza misura in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          timed(3) +
          note(12) +
          '<attributes><time><senza-misura/></time></attributes>',
        note(24),
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
    expect(result.globalMeasures[1]?.time).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:senza-misura',
        // The measure it is written in opens with a meter and keeps it; the
        // unmetered music starts at the measure after.
        message: expect.stringContaining('converted with the time signature in force'),
      }),
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  // The measure states no meter of its own, so MNX keeps the one before it in
  // force over it. What the unmetered statement costs is measured against
  // that, not against the measure's own silence.
  test('reports senza misura in a measure keeping the meter before it', () => {
    const { score: result, warnings } = read(
      part(
        opening + timed(2) + note(24),
        note(24) + '<attributes><time><senza-misura/></time></attributes>',
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      undefined,
      undefined,
    ])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:senza-misura'])
    expect(warnings[0]?.message).toContain('converted with the time signature in force')
  })

  test('reports a restatement partway through after one at the end of the measure', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(24) +
          timed(3) +
          '<backup><duration>24</duration></backup>' +
          note(12, 2) +
          timed(3) +
          note(12, 2),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('keeps a restatement partway through over one at the end of the measure', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          timed(3) +
          '<backup><duration>12</duration></backup>' +
          note(24, 2) +
          timed(3),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  test('names the first of two restatements at the same point', () => {
    const { warnings } = read(
      part(
        opening +
          timed(2) +
          note(12) +
          '\n' +
          timed(3) +
          '<backup><duration>12</duration></backup>' +
          note(12, 2) +
          '\n' +
          timed(3) +
          note(12, 2),
        note(36),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  // The first staff's is senza misura, which MNX cannot state, so the change
  // is the second staff's.
  test('names the time signature of a block that MNX can state', () => {
    const { warnings } = read(
      part(
        '<attributes><divisions>12</divisions><staves>2</staves></attributes>' +
          timed(2) +
          note(12) +
          '<attributes><time number="1"><senza-misura/></time>\n' +
          '<time number="2"><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note(12),
        note(36),
      ),
    )

    expect(warnings.filter((w) => w.code === 'unrepresentable:mid-measure-time')).toEqual([
      expect.objectContaining({ context: { part: 'P1', measure: 1, line: 2 } }),
    ])
  })

  test('carries one equal to a time signature the start of the measure did not convert', () => {
    const { score: result } = read(
      part(
        opening + timed(2) + note(24) + '<backup><duration>24</duration></backup>' + timed(3),
        note(24) + timed(3),
        note(36),
      ),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      undefined,
      { count: 3, unit: 4 },
    ])
  })

  test('carries nothing when the last statement returns to the time signature in force', () => {
    const { score: result, warnings } = read(
      part(opening + timed(2) + note(12) + timed(3) + note(6) + timed(2) + note(6), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-time',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  test("takes a statement at the start of the measure after a backup as the measure's own", () => {
    const { score: result, warnings } = read(
      part(
        opening + note(24) + '<backup><duration>24</duration></backup>' + timed(2) + note(24, 2),
      ),
    )

    expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
    expect(warnings).toEqual([])
  })

  describe('stated twice at the start of the measure', () => {
    const twice = (second: string) =>
      opening + timed(2) + note(24) + '<backup><duration>24</duration></backup>\n' + second

    test('keeps the first and reports a different second one', () => {
      const { score: result, warnings } = read(part(twice(timed(3) + note(24, 2)), note(24)))

      expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 2, unit: 4 }, undefined])
      expect(warnings).toEqual([
        expect.objectContaining({
          code: 'inconsistent:time',
          element: 'time',
          message: expect.stringContaining('The later one is not converted.'),
          context: { part: 'P1', measure: 1, line: 2 },
        }),
      ])
    })

    test('says nothing when the second restates the first', () => {
      const { warnings } = read(part(twice(timed(2) + note(24, 2))))

      expect(warnings).toEqual([])
    })

    test('reports a second meter stated for the only staff there is', () => {
      const numbered =
        '<attributes><time number="1"><beats>3</beats><beat-type>4</beat-type></time></attributes>'
      const { score: result, warnings } = read(part(twice(numbered + note(24, 2)), note(24)))

      expect(result.globalMeasures[0]?.time).toEqual({ count: 2, unit: 4 })
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
    })

    // A rest with no written value lasting the measure is the measure's rest,
    // so it shows which time signature the next measure is read against.
    test('reads the next measure against the one converted', () => {
      const rest = '<note><rest/><duration>24</duration><voice>1</voice></note>'
      const { score: result } = read(part(twice(timed(3) + note(24, 2)), rest))

      expect(result.parts[0]?.measures[1]?.sequences[0]?.fullMeasure).toBeDefined()
    })

    test('reads the next measure against a late one stated before the restatement', () => {
      const rest = '<note><rest/><duration>36</duration><voice>1</voice></note>'
      const { score: result } = read(
        part(
          opening +
            timed(2) +
            note(24) +
            timed(3) +
            '<backup><duration>24</duration></backup>' +
            timed(2) +
            note(24, 2),
          rest,
        ),
      )

      expect(result.globalMeasures.map((m) => m.time)).toEqual([
        { count: 2, unit: 4 },
        { count: 3, unit: 4 },
      ])
      expect(result.parts[0]?.measures[1]?.sequences[0]?.fullMeasure).toBeDefined()
    })

    test('reports one following senza misura', () => {
      const unmetered = '<attributes><time><senza-misura/></time></attributes>'
      const { score: result, warnings } = read(
        part(
          opening + unmetered + note(24) + '<backup><duration>24</duration></backup>' + timed(3),
        ),
      )

      expect(result.globalMeasures[0]?.time).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:senza-misura',
        'inconsistent:time',
      ])
    })
  })

  // A 3:2 quarter written short of its ratio, which the silence after it to
  // the barline completes. How much silence there is depends on the measure's
  // own time signature, not on the one stated late for the next measure.
  const shortTriplet =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
    '<voice>1</voice><type>quarter</type><time-modification><actual-notes>3</actual-notes>' +
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>' +
    '<notations><tuplet type="start" bracket="no"/><tuplet type="stop"/></notations></note>'

  test("measures the silence to the barline against the measure's own time signature", () => {
    const { warnings } = read(
      part(opening + timed(3) + note(24) + shortTriplet + timed(2), note(24)),
    )

    expect(warnings).toEqual([])
  })

  // The second part states no time signature, so its barline is the one the
  // first part's measure opens with.
  const untimedBeside = (first: string) =>
    score(
      `<part id="P1"><measure number="1">${opening + first}</measure>` +
        `<measure number="2">${note(24)}</measure></part>` +
        `<part id="P2"><measure number="1">${opening + note(24) + shortTriplet}</measure>` +
        `<measure number="2">${note(24)}</measure></part>`,
    )

  test('measures a part stating no time signature against the one the score opens with', () => {
    const { warnings } = read(untimedBeside(timed(3) + note(36) + timed(2)))

    expect(warnings).toEqual([])
  })

  // A figured bass states a <duration> but does not move the cursor.
  test('measures an untimed part against a time signature stated after a figured bass', () => {
    const { warnings } = read(
      untimedBeside(
        '<figured-bass><figure><figure-number>6</figure-number></figure>' +
          '<duration>12</duration></figured-bass>' +
          timed(3) +
          note(36),
      ),
    )

    expect(warnings.map((w) => [w.code, w.element])).toEqual([
      ['unrepresentable:element', 'figured-bass'],
    ])
  })

  test('measures an untimed part against the metered one of two per-staff time signatures', () => {
    const { warnings } = read(
      untimedBeside(
        '<attributes><staves>2</staves><time number="1"><senza-misura/></time>' +
          '<time number="2"><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note(36),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:senza-misura',
      'unrepresentable:per-staff-time',
    ])
  })

  test('takes a <forward> as the start of the music when reading ahead', () => {
    const { warnings } = read(
      untimedBeside(timed(3) + '<forward><duration>36</duration></forward>' + timed(2)),
    )

    expect(warnings).toEqual([])
  })

  test('does not take a grace note as the start of the music when reading ahead', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch>' +
      '<voice>1</voice><type>eighth</type></note>'
    const { warnings } = read(untimedBeside(grace + timed(3) + note(36)))

    expect(warnings).toEqual([])
  })

  // The second part states no time signature, so its second measure runs to
  // the barline the first part's second measure opens with.
  const untimedBesideNext = (first: string, length: number) =>
    score(
      `<part id="P1"><measure number="1">${opening + first}</measure>` +
        `<measure number="2">${note(24)}</measure></part>` +
        `<part id="P2"><measure number="1">${opening + note(length)}</measure>` +
        `<measure number="2">${note(24) + shortTriplet}</measure></part>`,
    )
  const back = (duration: number | string) =>
    `<backup><duration>${String(duration)}</duration></backup>`
  // A read's measures and warnings, or the refusal it ends in. The second
  // part's second measure runs past 2/4, so a read settling that time
  // signature there is refused.
  const outcome = (source: string) => {
    try {
      const { score: result, warnings } = read(source)
      return { measures: result.globalMeasures, codes: warnings.map((w) => w.code) }
    } catch (error) {
      if (error instanceof MusicXMLError) return error.detail
      throw error
    }
  }

  test.each([36, '36.0'])(
    'reads ahead a second statement at the start, after a <backup> of %s, as the first one stands',
    (backup) => {
      const { score: result, warnings } = read(
        untimedBesideNext(timed(3) + note(36) + back(backup) + timed(2) + note(36, 2), 36),
      )

      expect(result.globalMeasures.map((m) => m.time)).toEqual([{ count: 3, unit: 4 }, undefined])
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
    },
  )

  test('reads ahead a late statement before a restatement at the start', () => {
    const { score: result, warnings } = read(
      untimedBesideNext(timed(2) + note(24) + timed(3) + back(24) + timed(2) + note(24, 2), 24),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reads ahead a late statement before the first one at the start', () => {
    const { score: result, warnings } = read(
      untimedBesideNext(note(24) + timed(3) + back(24) + timed(2) + note(24, 2), 24),
    )

    expect(result.globalMeasures.map((m) => m.time)).toEqual([
      { count: 2, unit: 4 },
      { count: 3, unit: 4 },
    ])
    expect(warnings).toEqual([])
  })

  test('reads ahead a statement after a <forward> as late', () => {
    const { warnings } = read(
      untimedBesideNext(timed(2) + '<forward><duration>24</duration></forward>' + timed(3), 24),
    )

    expect(warnings).toEqual([])
  })

  test('reads ahead a chord as one step of the cursor', () => {
    const chord =
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch>' +
      '<duration>36</duration><voice>1</voice></note>'
    const { warnings } = read(
      untimedBesideNext(timed(3) + note(36) + chord + back(36) + timed(2) + note(36, 2), 36),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time'])
  })

  test('reads ahead a <backup> past the start as reaching the start', () => {
    const { warnings } = read(
      untimedBesideNext(timed(3) + note(36) + back(48) + timed(2) + note(36, 2), 36),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:time', 'inconsistent:backup'])
  })

  test('reads ahead a note written after a <backup> past the start as moving on from the start', () => {
    const { warnings } = read(
      untimedBesideNext(timed(2) + note(24) + back(48) + note(24, 2) + timed(3), 24),
    )

    expect(warnings.map((w) => w.code)).toEqual(['inconsistent:backup'])
  })

  test.each([
    ['24', '24'],
    ['24.0', '24'],
  ])('reads ahead a <backup> in the divisions stated before it: %s, %s', (divisions, backup) => {
    const { warnings } = read(
      score(
        `<part id="P1"><measure number="1">${opening + timed(2) + note(24)}` +
          `<attributes><divisions>${divisions}</divisions></attributes>` +
          `<backup><duration>${backup}</duration></backup>${timed(3)}</measure>` +
          `<measure number="2">${note(72)}</measure></part>` +
          `<part id="P2"><measure number="1">${opening + note(24)}</measure>` +
          `<measure number="2">${note(24) + shortTriplet}</measure></part>`,
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:mid-measure-time'])
  })

  test('reads ahead a note with no <duration> as lasting its written value', () => {
    const half =
      '<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><type>half</type></note>'
    const { warnings } = read(untimedBesideNext(timed(2) + half + timed(3), 24))

    expect(warnings).toEqual([])
  })

  // A <backup> of a half after a dotted half leaves the cursor past the start
  // only when the dot is counted.
  test('reads ahead a dotted note with no <duration> as lasting its dotted value', () => {
    const dottedHalf = (duration: string) =>
      `<note><pitch><step>C</step><octave>4</octave></pitch>${duration}` +
      '<voice>1</voice><type>half</type><dot/></note>'
    const first = (duration: string) =>
      outcome(untimedBesideNext(timed(3) + dottedHalf(duration) + back(24) + timed(2), 36))
    const stated = first('<duration>36</duration>')

    expect(stated).toEqual(expect.stringContaining('past the 2/4'))
    expect(first('')).toEqual(stated)
  })

  test('reads ahead a rest with no <duration> as lasting its written value', () => {
    const half = '<note><rest/><voice>1</voice><type>half</type></note>'
    const { warnings } = read(untimedBesideNext(timed(2) + half + timed(3), 24))

    expect(warnings).toEqual([])
  })

  // A bar of silence is drawn as a whole rest in any meter, so a rest marked
  // as the measure's lasts what the time signature states. A <backup> of the
  // measure's length after it returns to the start only where it does.
  test("reads ahead a measure's rest with no <duration> as lasting the measure", () => {
    const whole = (stated: string) =>
      `<note><rest measure="yes"/>${stated}<voice>1</voice><type>whole</type></note>`
    const first = (stated: string) =>
      outcome(untimedBesideNext(timed(3) + whole(stated) + back(36) + timed(2), 36))

    expect(first('')).toEqual(first('<duration>36</duration>'))
  })

  // With no time signature in force, the written value is all there is.
  test("reads ahead a measure's rest with no <duration> and no time as its written value", () => {
    const half = (duration: string) =>
      `<note><rest measure="yes"/>${duration}<voice>1</voice><type>half</type></note>`
    const first = (duration: string) => read(untimedBesideNext(half(duration) + timed(3), 24))
    const stated = first('<duration>24</duration>')
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // The reader drops an extra rest over the measure rest, and still passes
  // over it from the measure start. The read-ahead counts it the same way.
  test('reads ahead a dropped extra rest with no <duration> as the reader passes over it', () => {
    const measureRest = '<note><rest measure="yes"/><duration>24</duration><voice>1</voice></note>'
    const extra = (duration: string) =>
      `<note><rest/>${duration}<voice>1</voice><type>quarter</type></note>`
    const forward = '<forward><duration>12</duration></forward>'
    const first = (duration: string) =>
      read(
        untimedBesideNext(
          timed(2) + measureRest + back(48) + extra(duration) + forward + timed(3),
          24,
        ),
      )
    const stated = first('<duration>12</duration>')
    const unstated = first('')

    expect(unstated.score.globalMeasures).toEqual(stated.score.globalMeasures)
    expect(unstated.warnings.map((w) => w.code)).toEqual(stated.warnings.map((w) => w.code))
  })

  // A <backup> of the two notes' length returns to the start only where the
  // triplet lasts the quarter its ratio gives it.
  test('reads ahead a note with no <duration> inside a tuplet as its ratio scales it', () => {
    const triplet = (duration: string) =>
      ['start', '', 'stop']
        .map(
          (bracket) =>
            `<note><pitch><step>C</step><octave>4</octave></pitch>${duration}<voice>1</voice>` +
            '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification>' +
            (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
            '</note>',
        )
        .join('')
    const first = (duration: string) =>
      outcome(
        untimedBesideNext(
          timed(2) + triplet(duration) + note(12) + back(24) + timed(3) + note(24, 2),
          24,
        ),
      )

    expect(first('')).toEqual(first('<duration>4</duration>'))
  })

  // A note of a two-note tremolo lasts half its written value, whether or not
  // it states the pair's ratio. A single-note tremolo scales nothing. A
  // <backup> of a quarter returns to the start only where the pair lasts one.
  test.each([
    ['a two-note tremolo', (type: string) => `<tremolo type="${type}">2</tremolo>`, 6],
    [
      'a two-note tremolo in a second <ornaments>',
      (type: string) => `<trill-mark/></ornaments><ornaments><tremolo type="${type}">2</tremolo>`,
      6,
    ],
    [
      'a two-note tremolo after a single-note one',
      (type: string) => `<tremolo type="single">3</tremolo><tremolo type="${type}">2</tremolo>`,
      6,
    ],
    ['a single-note tremolo', () => '<tremolo type="single">3</tremolo>', 12],
  ])('reads ahead %s stating no ratio and no <duration>', (_, ornament, units) => {
    const notes = (duration: string) =>
      ['start', 'stop']
        .map(
          (type) =>
            `<note><pitch><step>C</step><octave>4</octave></pitch>${duration}<voice>1</voice>` +
            `<type>quarter</type><notations><ornaments>${ornament(type)}</ornaments></notations>` +
            '</note>',
        )
        .join('')
    const first = (duration: string) =>
      outcome(untimedBesideNext(timed(2) + notes(duration) + back(12) + timed(3) + note(12, 2), 24))

    expect(first('')).toEqual(first(`<duration>${String(units)}</duration>`))
  })

  test.each(['actual-notes', 'normal-notes'])(
    'reads ahead a <%s> of 0, which the part reader refuses',
    (name) => {
      const zero =
        '<note><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice>' +
        '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
        '<normal-notes>2</normal-notes></time-modification></note>'
      const source = untimedBesideNext(
        timed(2) + zero.replace(new RegExp(`(<${name}>)\\d`), '$10') + timed(3),
        24,
      )

      expect(() => read(source)).toThrow(MusicXMLError)
    },
  )

  test('reads ahead a grace note stating a <duration> as taking no time', () => {
    const grace =
      '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration>' +
      '<voice>1</voice><type>eighth</type></note>'
    const error = readFailure(untimedBesideNext(timed(2) + grace + timed(3) + note(24), 24))

    expect(error.detail).toContain('past the 2/4')
    expect(error.path).toEqual(['score-partwise', 'part P2', 'measure 2'])
  })

  test.each(['0', '-3000000000000000'])(
    'reads ahead past a <divisions> of %s, which the part reader refuses',
    (written) => {
      const divisions = `<attributes><divisions>${written}</divisions></attributes>`

      expect(readFailure(untimedBesideNext(divisions + timed(3) + note(36), 36)).message).toContain(
        `<divisions> is ${written}, outside the range`,
      )
    },
  )

  test('reads ahead a broken time signature as stating none', () => {
    const composite =
      '<attributes><time><beats>3</beats><beat-type>4</beat-type>' +
      '<beats>2</beats><beat-type>4</beat-type></time></attributes>'

    const failure = readFailure(untimedBesideNext(timed(3) + note(36) + composite, 36))

    expect(failure.message).toMatch(/composite time signature/)
    expect(failure.path).toEqual(['score-partwise', 'part P1', 'measure 1'])
  })

  // An unmetered measure has no barline to measure silence to, so the time
  // signature before it does not complete a bracket in it.
  test('measures a senza misura measure against no time signature', () => {
    const { warnings } = read(
      part(
        opening + timed(3) + note(36),
        '<attributes><time><senza-misura/></time></attributes>' + note(24) + shortTriplet,
      ),
    )

    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tuplet-ratio')
  })

  test('converts to legal MNX', () => {
    convertValid(part(opening + timed(2) + note(12) + timed(3) + note(12), note(36)))
  })
})

// MNX states a key signature at the start of a measure only, as it does a
// time signature.
describe('a key signature stated after the measure start', () => {
  const keyed = (fifths: number) =>
    `<attributes><key><fifths>${String(fifths)}</fifths></key></attributes>`
  const note = (duration: number | string, voice = 1) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch>' +
    `<duration>${String(duration)}</duration><voice>${String(voice)}</voice></note>`
  const measures = (...bodies: string[]) =>
    bodies.map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`).join('')
  const part = (...bodies: string[]) => score(`<part id="P1">${measures(...bodies)}</part>`)
  const opening =
    '<attributes><divisions>12</divisions>' +
    '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>'

  test('takes effect at the next measure when stated after the notes', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([])
  })

  test('adds nothing when it restates the key in force', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(2) + note(24) + keyed(2), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 2 }, undefined])
    expect(warnings).toEqual([])
  })

  test('adds nothing when the next measure restates it', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), keyed(2) + note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([])
  })

  test('reports a change partway through a measure and converts it at the next', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + '\n' + keyed(2) + note(12), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        element: 'key',
        message: expect.stringMatching(
          /^A key signature is stated partway through .* It is converted at the next measure\.$/,
        ),
        context: { part: 'P1', measure: 1, line: 2 },
      }),
    ])
  })

  test('reports one the next measure replaces with its own', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(24) + keyed(2), keyed(-1) + note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: -1 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringMatching(
          /at the end of .* The next measure states its own, so it is not converted\.$/,
        ),
        context: expect.objectContaining({ measure: 1 }),
      }),
    ])
  })

  test('reports one stated after the notes of the last measure', () => {
    const { warnings } = read(part(opening + keyed(0) + note(24) + keyed(2)))

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining(
          'This is the last measure of the part, so it is not converted.',
        ),
      }),
    ])
  })

  test('reports one a later statement in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + keyed(2) + note(12) + keyed(3), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 3 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining(
          'A later one in this measure replaces it, so it is not converted.',
        ),
      }),
    ])
  })

  test('does not carry one a later non-traditional key in the same measure replaces', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(12) +
          keyed(2) +
          note(12) +
          '<attributes><key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>',
        note(24),
      ),
    )

    expect(result.globalMeasures[1]?.key).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'unrepresentable:non-traditional-key' }),
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  // The cursor is back inside the measure, although every note in it is read.
  test('takes a statement after a <backup> into the measure as partway through', () => {
    const { warnings } = read(
      part(
        opening + keyed(0) + note(24) + '<backup><duration>12</duration></backup>' + keyed(2),
        note(24),
      ),
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('partway through'),
      }),
    ])
  })

  // The two statements are one change, written once for each voice. The
  // second stands partway through the measure, so the change is a loss.
  test('reports a restatement partway through after one at the end of the measure', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(24) +
          keyed(2) +
          '<backup><duration>24</duration></backup>' +
          note(12, 2) +
          keyed(2) +
          note(12, 2),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 2 }])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringMatching(/partway through .* It is converted at the next measure\.$/),
      }),
    ])
  })

  test('carries one stated after a non-traditional key in the same measure', () => {
    const { score: result, warnings } = read(
      part(
        opening +
          keyed(0) +
          note(24) +
          '<attributes><key><key-step>F</key-step><key-alter>1</key-alter>' +
          '<key-accidental>sharp</key-accidental></key></attributes>' +
          keyed(2),
        note(24),
      ),
    )

    expect(result.globalMeasures[1]?.key).toEqual({ fifths: 2 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:non-traditional-key'])
  })

  // A second key at the start of a measure is not converted, so the key in
  // force is still the first one.
  test('carries one equal to a key the start of the measure did not convert', () => {
    const { score: result } = read(
      part(
        opening + keyed(0) + note(24) + '<backup><duration>24</duration></backup>' + keyed(2),
        note(24) + keyed(2),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([
      { fifths: 0 },
      undefined,
      { fifths: 2 },
    ])
  })

  test('carries nothing when the last statement returns to the key in force', () => {
    const { score: result, warnings } = read(
      part(opening + keyed(0) + note(12) + keyed(2) + note(6) + keyed(0) + note(6), note(24)),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'unrepresentable:mid-measure-key',
        message: expect.stringContaining('A later one in this measure replaces it'),
      }),
    ])
  })

  test("takes a statement at the start of the measure after a backup as the measure's own", () => {
    const { score: result, warnings } = read(
      part(
        opening + note(24) + '<backup><duration>24</duration></backup>' + keyed(2) + note(24, 2),
      ),
    )

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 2 })
    expect(warnings).toEqual([])
  })

  describe('stated twice at the start of the measure', () => {
    const twice = (first: string, second: string) =>
      opening + first + note(24) + '<backup><duration>24</duration></backup>\n' + second

    test('keeps the first and reports a different second one', () => {
      const { score: result, warnings } = read(part(twice(keyed(0), keyed(2)), note(24)))

      expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
      expect(warnings).toEqual([
        expect.objectContaining({
          code: 'inconsistent:key',
          element: 'key',
          message: expect.stringContaining('The later one is not converted.'),
          context: { part: 'P1', measure: 1, line: 2 },
        }),
      ])
    })

    test('says nothing when the second restates the first', () => {
      const { warnings } = read(part(twice(keyed(2), keyed(2))))

      expect(warnings).toEqual([])
    })

    // A number tells several staves apart, and a part written on one staff
    // has nothing to tell apart, so a second statement naming staff 1 is a
    // second statement for the part.
    test('reports a second one stated for the only staff there is', () => {
      const numbered = '<attributes><key number="1"><fifths>2</fifths></key></attributes>'
      const { score: result, warnings } = read(part(twice(keyed(0), numbered), note(24)))

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: 0 })
      expect(warnings.map((w) => w.code)).toEqual(['inconsistent:key'])
    })

    test('reports one following a key MNX cannot carry', () => {
      const nonTraditional =
        '<attributes><key><key-step>F</key-step><key-alter>1</key-alter></key></attributes>'
      const { score: result, warnings } = read(part(twice(nonTraditional, keyed(2))))

      expect(result.globalMeasures[0]?.key).toBeUndefined()
      expect(warnings.map((w) => w.code)).toEqual([
        'unrepresentable:non-traditional-key',
        'inconsistent:key',
      ])
    })
  })

  // Two sharps written read back as C major, which is the key in force.
  test('adds nothing when a transposing part restates its written key', () => {
    const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const { score: result, warnings } = read(
      part(
        opening.replace('</attributes>', `${B_FLAT}</attributes>`) +
          keyed(2) +
          note(12) +
          keyed(2) +
          note(12),
        note(24),
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, undefined])
    expect(warnings).toEqual([])
  })

  // Written a major second above what it sounds, so five flats written read
  // back as seven flats of concert key: the five sharps the other part states,
  // spelled the other way.
  test('carries the concert key of a transposing part, and settles its flip', () => {
    const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
    const { score: result, warnings } = read(
      score(
        `<part id="P1">${measures(opening + keyed(0) + note(24), keyed(5) + note(24))}</part>` +
          '<part id="P2">' +
          measures(
            opening.replace('</attributes>', `${B_FLAT}</attributes>`) +
              keyed(2) +
              note(24) +
              keyed(-5),
            note(24),
          ) +
          '</part>',
      ),
    )

    expect(result.globalMeasures.map((m) => m.key)).toEqual([{ fifths: 0 }, { fifths: 5 }])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeDefined()
    expect(warnings).toEqual([])
  })

  test('converts to legal MNX', () => {
    convertValid(part(opening + keyed(0) + note(12) + keyed(2) + note(12), note(24)))
  })
})

// A part avoids a signature of more than seven sharps or flats by writing
// the enharmonic one: five sharps of concert key are written for a B-flat
// instrument as five flats rather than the seven sharps its transposition
// asks for. Read back, that gives a concert key twelve fifths from the
// score's, which is the same key spelled the other way. MNX states where
// the part flips, so the score keeps one key and nothing is lost.
describe('a part that flips its key signature enharmonically', () => {
  /** A part in `fifths`, transposing by `transpose` where it states one. */
  const keyed = (id: string, fifths: number, transpose = '') =>
    `<part id="${id}"><measure number="1"><attributes>` +
    `<key><fifths>${String(fifths)}</fifths></key>${transpose}` +
    `</attributes>${NOTE}</measure></part>`

  /** Written a major second above what it sounds. */
  const B_FLAT = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>'
  /** Written a minor third below what it sounds. */
  const E_FLAT = '<transpose><diatonic>2</diatonic><chromatic>3</chromatic></transpose>'

  test('states where it flips, and reports no disagreement', () => {
    const { score: result, warnings } = read(score(keyed('P1', 5) + keyed('P2', -5, B_FLAT)))

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 5 })
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  // A concert part states the score's key in the score's spelling, so its
  // key is settled first wherever it stands in the file.
  test('states where it flips when it comes before the concert part', () => {
    const { score: result, warnings } = read(score(keyed('P1', -5, B_FLAT) + keyed('P2', 5)))

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 5 })
    expect(result.parts[0]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  // A drum part's key says nothing about pitch, so it does not settle the
  // score's key before the trumpet.
  test('settles a transposing part before a part that strikes a kit', () => {
    const drums =
      '<part id="P2"><measure number="1"><attributes><key><fifths>0</fifths></key>' +
      '<clef><sign>percussion</sign></clef></attributes>' +
      '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave>' +
      '</unpitched><duration>4</duration><type>quarter</type></note></measure></part>'
    const { score: result, warnings } = read(score(keyed('P1', 1, B_FLAT) + drums))

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: -1 })
    expect(
      warnings
        .filter((w) => w.code === 'unrepresentable:cross-part-key')
        .map((w) => w.context.part),
    ).toEqual(['P2'])
  })

  // A concert part and a transposing part in different keys: the concert
  // part's key is converted, and the transposing part is the one reported.
  test('converts the concert part’s key where a transposing part before it disagrees', () => {
    const { score: result, warnings } = read(score(keyed('P1', 3, B_FLAT) + keyed('P2', 0)))

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: 0 })
    expect(warnings.map((w) => [w.code, w.context.part])).toEqual([
      ['unrepresentable:cross-part-key', 'P1'],
    ])
  })

  // The part named is one of those that disagree, and either can be the one
  // drawn in a key it does not state, so the message does not say which.
  test('says a part is drawn in a key it does not state, not which key is kept', () => {
    const { warnings } = read(score(keyed('P1', 3, B_FLAT) + keyed('P2', 0)))

    expect(warnings[0]?.message).toBe(
      'The parts of this score are in different keys, and MNX states one key for the ' +
        'score, so a part is drawn in a key its source does not state.',
    )
  })

  // The point is measured in the fifths the part would write without the
  // flip, so the seven sharps the source drew come back from the score's
  // key and the point together.
  test('brings back the signature the source drew', () => {
    const { mnx } = convertValid(score(keyed('P1', 5) + keyed('P2', -5, B_FLAT)))
    const flipAt = mnx.parts[1]?.transposition?.keyFifthsFlipAt ?? 0
    const interval = mnx.parts[1]?.transposition?.interval
    const concert = mnx.global.measures[0]?.key?.fifths ?? 0
    const written = concert - 12 * (interval?.staffDistance ?? 0) + 7 * (interval?.halfSteps ?? 0)

    expect(written >= flipAt ? written - 12 : written).toBe(-5)
  })

  // The score's key is the first stated at a measure, so a measure where
  // only the flipping part states one would take its spelling and re-spell
  // every other part. What it contributes is the key, in the score's own
  // spelling.
  test('contributes the score’s spelling where it is the only part stating one', () => {
    const restated =
      `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
      `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(restated))

    expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
      { fifths: 5 },
      { fifths: 5 },
    ])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  // A measure the score states no key at has nothing to compare the part
  // against, so the flip is settled by the signature the part writes rather
  // than by how far the merge has reached: the reading another measure of
  // the part settled for the same signature is the one contributed here.
  // Otherwise the measure takes the flipped spelling and the score gains a
  // key change the source does not have.
  test('contributes the score\u2019s spelling before the score states a key', () => {
    const late =
      `<part id="P1"><measure number="1">${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>5</fifths></key></attributes>` +
      `${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(late))

    expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
      { fifths: 5 },
      { fifths: 5 },
    ])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  // Four flats read back as G-flat or, through the flip, as F-sharp, and no
  // other measure settles four flats. F-sharp is nearer the five sharps the
  // score settles at the next measure, so the spelling stays on that side.
  test('spells a signature no measure settles near the key of the nearest that is', () => {
    const unsettled =
      `<part id="P1"><measure number="1">${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>5</fifths></key></attributes>` +
      `${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-4</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(unsettled))

    expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
      { fifths: 6 },
      { fifths: 5 },
    ])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  describe('spelling a signature no measure settles', () => {
    /** P1 at concert pitch and P2 transposing, each a list of keys by measure. */
    const parts = (
      concert: (number | undefined)[],
      transposing: (number | undefined)[],
      transpose: string,
    ) => {
      const part = (id: string, keys: (number | undefined)[], extra: string) =>
        `<part id="${id}">` +
        keys
          .map(
            (fifths, index) =>
              `<measure number="${String(index + 1)}"><attributes>` +
              (fifths === undefined ? '' : `<key><fifths>${String(fifths)}</fifths></key>`) +
              (index === 0 ? extra : '') +
              `</attributes>${NOTE}</measure>`,
          )
          .join('') +
        '</part>'
      return read(score(part('P1', concert, '') + part('P2', transposing, transpose))).score
    }

    test('looks past a measure that settles nothing for the nearest that does', () => {
      const result = parts([undefined, undefined, 5], [-4, undefined, -5], B_FLAT)

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: 6 })
    })

    // Flipping up: a D trumpet, written a major second below what it sounds,
    // writes the score's six flats as four sharps. Three sharps read back as
    // B major or as C-flat, which is nearer.
    test('spells toward the nearest settled key for a part that flips up', () => {
      const D_TRUMPET = '<transpose><diatonic>1</diatonic><chromatic>2</chromatic></transpose>'
      const result = parts([undefined, -6], [3, 4], D_TRUMPET)

      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(-8)
      expect(result.globalMeasures[0]?.key).toEqual({ fifths: -7 })
    })

    // One sharp reads back as F major or, through the flip, eleven sharps, each
    // six fifths from the five sharps settled next.
    test('reads a signature as it stands where both readings are as near', () => {
      const result = parts([undefined, 5], [1, -5], B_FLAT)

      expect(result.globalMeasures[0]?.key).toEqual({ fifths: -1 })
    })
  })

  // With the flip at eight, five sharps write seven sharps, not the five flats
  // the part writes. Only the direct reading, C-flat, writes them back.
  test('keeps the direct reading where the other does not write the signature back', () => {
    const unsettled =
      `<part id="P1"><measure number="1">${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>6</fifths></key></attributes>` +
      `${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-4</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result } = read(score(unsettled))

    expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
      { fifths: -7 },
      { fifths: 6 },
    ])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(8)
  })

  // Seven sharps and, at the next measure, five flats both read back as the
  // score's five sharps: the part flips at one and not the other. MNX states
  // one flip point, so the seven sharps cannot be drawn, and that is reported.
  test('reports a signature the flip point cannot write back', () => {
    const both =
      `<part id="P1"><measure number="1">${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>5</fifths></key></attributes>` +
      `${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>7</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-5</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(both))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings.map((w) => [w.code, w.context.part, w.context.measure])).toEqual([
      ['unrepresentable:cross-part-key', 'P2', 1],
    ])
  })

  // The score's key in force settles the reading before any other measure
  // does, so a part restating its signature after the score changes spelling
  // takes the new spelling.
  test('contributes the score’s spelling in force after the score changes it', () => {
    const respelled =
      `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
      `</attributes>${NOTE}</measure>` +
      `<measure number="2"><attributes><key><fifths>-7</fifths></key></attributes>` +
      `${NOTE}</measure><measure number="3">${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure>` +
      `<measure number="3"><attributes><key><fifths>-5</fifths></key></attributes>` +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(respelled))

    expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
      { fifths: 5 },
      { fifths: -7 },
      { fifths: -7 },
    ])
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
    convertValid(score(respelled))
  })

  // The ordinary transposing part: it writes the signature its transposition
  // asks for, so there is nothing to flip and no point to state.
  test('states no point for a part writing the signature it is asked for', () => {
    const { score: result, warnings } = read(score(keyed('P1', 0) + keyed('P2', 2, B_FLAT)))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
    expect(warnings).toEqual([])
  })

  // The other direction, which is the one the test suite's transposing-
  // instruments file reaches: the score's nine flats leave a B-flat
  // instrument seven flats to write, and it writes five sharps instead. A
  // point below zero adds the twelve fifths back rather than taking them off.
  test('states a point below zero for a part writing the sharper signature', () => {
    const { score: result, warnings } = read(score(keyed('P1', -9) + keyed('P2', 5, B_FLAT)))

    expect(result.globalMeasures[0]?.key).toEqual({ fifths: -9 })
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(-7)
    expect(warnings).toEqual([])
  })

  // A measure the part states no key in contributes none: the key it stands
  // in was settled where it was stated.
  test('contributes nothing for a measure the part states no key in', () => {
    const twoMeasures =
      '<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>' +
      `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
      '<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>' +
      `${B_FLAT}</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(twoMeasures))

    expect(result.globalMeasures[1]?.key).toBeUndefined()
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(7)
    expect(warnings).toEqual([])
  })

  // A part in a different key with no point to state contributes the key it
  // is in, not the score's, and the disagreement is reported.
  test('contributes its own key where it differs and no point is stated', () => {
    const later =
      '<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>' +
      `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
      `<part id="P2"><measure number="1">${NOTE}</measure>` +
      '<measure number="2"><attributes><key><fifths>-9</fifths></key></attributes>' +
      `${NOTE}</measure></part>`
    const { score: result, warnings } = read(score(later))

    expect(result.globalMeasures[1]?.key).toEqual({ fifths: -9 })
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
  })

  // One point cannot state a part that writes seven sharps and then five
  // flats for the same five sharps of concert key. The flat spelling is
  // the score's key spelled the other way, so it does not re-spell the
  // parts that stated the key first.
  test.each([
    ['at the measure start', '', '<attributes><key><fifths>-5</fifths></key></attributes>'],
    ['late in the measure before', '<attributes><key><fifths>-5</fifths></key></attributes>', ''],
  ])(
    'keeps the score’s spelling where a part with no point flips %s',
    (_name, lateInFirst, atSecond) => {
      const flipped =
        `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
        `</attributes>${NOTE}</measure><measure number="2">${NOTE}</measure></part>` +
        `<part id="P2"><measure number="1"><attributes><key><fifths>7</fifths></key>` +
        `${B_FLAT}</attributes>${NOTE}${lateInFirst}</measure>` +
        `<measure number="2">${atSecond}${NOTE}</measure></part>`
      const { score: result, warnings } = read(score(flipped))

      expect(result.globalMeasures.map((measure) => measure.key)).toEqual([
        { fifths: 5 },
        { fifths: 5 },
      ])
      expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
      expect(warnings.map((w) => [w.code, w.context])).toEqual([
        ['unrepresentable:cross-part-key', { part: 'P2', measure: 2 }],
      ])
      convertValid(score(flipped))
    },
  )

  // A transposing part can be in a different key outright, which no point
  // accounts for: only twelve fifths is the same key spelled the other way.
  test('reports a transposing part in a different key', () => {
    const { score: result, warnings } = read(score(keyed('P1', 0) + keyed('P2', 5, B_FLAT)))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
  })

  // The same point covers a part that flips only where the signature runs
  // deep into the flats and writes what it is asked for elsewhere.
  test('states one point below zero for a part that flips only in the flats', () => {
    const change = (fifths: number) =>
      `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
      `</attributes>${NOTE}</measure>`
    const mixed =
      `<part id="P1"><measure number="1"><attributes><key><fifths>-9</fifths></key>` +
      `</attributes>${NOTE}</measure>${change(0)}</part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>${change(2)}</part>`
    const { score: result, warnings } = read(score(mixed))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(-7)
    expect(warnings).toEqual([])
  })

  // A part at concert pitch has no transposition to state a flip on, so a
  // signature twelve fifths from the score's is a disagreement it cannot
  // settle.
  test('reports a part at concert pitch spelling the key the other way', () => {
    const { warnings } = read(score(keyed('P1', 5) + keyed('P2', -7)))

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
  })

  /** Two parts at concert pitch, each stating the keys given, measure by measure. */
  const concert = (...parts: readonly (number | undefined)[][]) =>
    parts
      .map(
        (keys, index) =>
          `<part id="P${String(index + 1)}">` +
          keys
            .map(
              (fifths, measure) =>
                `<measure number="${String(measure + 1)}">` +
                (fifths === undefined
                  ? ''
                  : `<attributes><key><fifths>${String(fifths)}</fifths></key></attributes>`) +
                `${NOTE}</measure>`,
            )
            .join('') +
          '</part>',
      )
      .join('')

  // A part at concert pitch has no point to state either. Where an earlier
  // part has the measure and the score's key is in force, the other
  // spelling is that key. Elsewhere it is the only key stated.
  const key = (measure: number) => ['unrepresentable:cross-part-key', { part: 'P2', measure }]
  test.each([
    [
      'the score’s spelling for the same key written flatter',
      [5, undefined],
      [5, -7],
      [5, 5],
      [key(2)],
    ],
    [
      'the score’s spelling for the same key written sharper',
      [-7, undefined],
      [-7, 5],
      [-7, -7],
      [key(2)],
    ],
    [
      'the score’s spelling after the score changes it',
      [5, -7, undefined],
      [5, undefined, 5],
      [5, -7, -7],
      [key(2), key(3)],
    ],
    [
      'its own spelling where the score has no key in force yet',
      [undefined, -7],
      [5, undefined],
      [5, -7],
      [key(2)],
    ],
  ])('contributes %s', (_name, first, second, expected, reported) => {
    const source = score(concert(first, second))
    const { score: result, warnings } = read(source)

    expect(result.globalMeasures.map((measure) => measure.key?.fifths)).toEqual(expected)
    expect(warnings.map((w) => [w.code, w.context])).toEqual(reported)
    convertValid(source)
  })

  // One point covers the whole part and its sign picks the direction, so a
  // part taking twelve fifths off at one key change and adding twelve at
  // the next cannot be stated. The score's nine flats leave a B-flat
  // instrument seven flats to write, which it spells as five sharps.
  test('reports a part flipping both ways', () => {
    const change = (fifths: number) =>
      `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
      `</attributes>${NOTE}</measure>`
    const both =
      `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
      `</attributes>${NOTE}</measure>${change(-9)}</part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>${change(5)}</part>`
    const { score: result, warnings } = read(score(both))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:cross-part-key',
      'unrepresentable:cross-part-key',
    ])
  })

  // The point stands between the keys the part flips and the keys it writes
  // as its transposition asks, so a part that flips at a smaller signature
  // than one it leaves alone cannot be stated either.
  test('reports a part flipping at a smaller signature than one it leaves alone', () => {
    const change = (fifths: number) =>
      `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
      `</attributes>${NOTE}</measure>`
    const mixed =
      `<part id="P1"><measure number="1"><attributes><key><fifths>5</fifths></key>` +
      `</attributes>${NOTE}</measure>${change(6)}</part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>-5</fifths></key>` +
      `${B_FLAT}</attributes>${NOTE}</measure>${change(8)}</part>`
    const { score: result, warnings } = read(score(mixed))

    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:cross-part-key'])
  })

  // A part that flips at a large signature and writes a small one as its
  // transposition asks is covered by one point, which stands between them.
  test('states one point for a part that flips only where the signature is large', () => {
    const change = (fifths: number, transpose = '') =>
      `<measure number="2"><attributes><key><fifths>${String(fifths)}</fifths></key>` +
      `${transpose}</attributes>${NOTE}</measure>`
    const mixed =
      `<part id="P1"><measure number="1"><attributes><key><fifths>0</fifths></key>` +
      `</attributes>${NOTE}</measure>${change(5)}</part>` +
      `<part id="P2"><measure number="1"><attributes><key><fifths>3</fifths></key>` +
      `${E_FLAT}</attributes>${NOTE}</measure>${change(-4)}</part>`
    const { score: result, warnings } = read(score(mixed))

    // An E-flat instrument writes three fifths above what it sounds: the
    // score's C major is its three sharps, and the score's five sharps
    // would be eight, written as four flats instead.
    expect(result.parts[1]?.transposition?.keyFifthsFlipAt).toBe(8)
    expect(warnings).toEqual([])
  })
})

// The reader works out the time signature each measure opens with before it
// reads the part, walking each measure with a cursor of its own. It has to
// place a time signature where the measure builder does: at the measure
// start, or partway through, where it takes effect at the next measure.
describe('the time signature worked out ahead of a part', () => {
  const pitch = '<pitch><step>C</step><octave>4</octave></pitch>'
  const quarter = `<note>${pitch}<duration>4</duration><type>quarter</type></note>`
  const threeFour = '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>'

  function opened(before: string, after: string): { readAhead: string[]; output: string[] } {
    const measures = [
      '<attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type>' +
        `</time></attributes>${quarter}${quarter}`,
      before + threeFour + after,
      quarter,
    ]
    const source =
      '<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part>' +
      '</part-list><part id="P1">' +
      measures
        .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
        .join('') +
      '</part></score-partwise>'
    const named = (time: { count: number; unit: number } | undefined) =>
      time ? `${String(time.count)}/${String(time.unit)}` : 'none'
    let inForce: { count: number; unit: number } | undefined
    const output = convertValid(source).mnx.global.measures.map((measure) =>
      named((inForce = measure.time ?? inForce)),
    )
    const part = parseXmlRoot(source).children.find((found) => found.name === 'part')
    return { readAhead: timesInForce(part!).map(named), output }
  }

  test.each([
    ['nothing', '', '3/4'],
    ['a <backup> to the measure start', `${quarter}<backup><duration>4</duration></backup>`, '3/4'],
    ['a <forward>', '<forward><duration>4</duration></forward>', '2/4'],
    ['a grace note', `<note><grace/>${pitch}<type>eighth</type></note>`, '3/4'],
    [
      'a <backup> past the start that a <forward> does not undo',
      `${quarter}<backup><duration>8</duration></backup><forward><duration>2</duration></forward>`,
      '3/4',
    ],
    [
      'a note after a <backup> past the start',
      `${quarter}<backup><duration>8</duration></backup>${quarter}`,
      '2/4',
    ],
    [
      'a chord note and a <backup> to the measure start',
      `${quarter}<note><chord/>${pitch}<duration>4</duration><type>quarter</type></note>` +
        '<backup><duration>4</duration></backup>',
      '3/4',
    ],
    [
      'a note with no <duration>, scaled by its ratio',
      `<note>${pitch}<type>eighth</type><time-modification><actual-notes>3</actual-notes>` +
        '<normal-notes>2</normal-notes></time-modification></note>',
      '2/4',
    ],
    [
      'a rest marked as the measure with no <duration>',
      '<note><rest measure="yes"/></note>',
      '2/4',
    ],
  ])('places a time signature after %s where the measure does', (_name, before, second) => {
    // A rest filling the measure leaves no room in its voice for a note.
    const { readAhead, output } = opened(before, before.includes('measure="yes"') ? '' : quarter)

    expect(readAhead[1]).toBe(second)
    expect(readAhead).toEqual(output)
  })
})
