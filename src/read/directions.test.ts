// A <direction> sits between the notes, at wherever the cursor has reached. A
// dynamic goes on the part's measure at that position; a metronome mark goes
// on the score's measure, since tempo is the whole score's. What MNX cannot
// state, like a word or a pedal, is reported.

import { describe, expect, test } from 'vitest'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

function note(step: string, quarters = 1): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(quarters * 4)}</duration><type>quarter</type></note>`
  )
}

function direction(body: string): string {
  return `<direction><direction-type>${body}</direction-type></direction>`
}

function inMeasure(body: string): string {
  return (
    '<score-partwise><part id="P1"><measure number="1">' +
    '<attributes><divisions>4</divisions></attributes>' +
    `${body}</measure></part></score-partwise>`
  )
}

function read(source: string) {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)
  return {
    measure: score.parts[0]?.measures[0],
    global: score.globalMeasures[0],
    warnings: warnings.list(),
  }
}

describe('dynamics', () => {
  test('places a dynamic on the measure at the cursor', () => {
    const { measure } = read(inMeasure(direction('<dynamics><f/></dynamics>') + note('C')))

    expect(measure?.dynamics).toEqual([{ position: { num: 0, den: 1 }, value: 'f' }])
  })

  test('places a dynamic partway through the measure', () => {
    const { measure } = read(
      inMeasure(note('C') + direction('<dynamics><p/></dynamics>') + note('D')),
    )

    expect(measure?.dynamics[0]?.position).toEqual({ num: 1, den: 4 })
  })

  test('reads which side of the staff the dynamic is placed', () => {
    const { measure } = read(
      inMeasure(
        '<direction placement="above"><direction-type><dynamics><f/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.orient).toBe('above')
  })

  test('writes the dynamic side onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(
      inMeasure(
        '<direction placement="below"><direction-type><dynamics><p/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"orient":"below"')
    expect(schemaErrors(mnx)).toEqual([])
  })

  test.each(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'])('reads %s', (value) => {
    const { measure } = read(inMeasure(direction(`<dynamics><${value}/></dynamics>`) + note('C')))

    expect(measure?.dynamics[0]?.value).toBe(value)
  })

  // The extreme plain dynamics run past MNX's dynamic-value enum, which stops
  // at fff, so one of those is still reported.
  test('reports a dynamic MNX has no value for', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><ffff/></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.message)).toContain('A dynamic of "ffff" is not converted yet.')
  })

  // The accent dynamics (sforzando and its family) are drawn as one combined
  // glyph. MNX states them as an accent group carrying the SMuFL glyph, which
  // is what keeps sf, fz and rfz apart where a bare accent could not.
  test.each([
    ['sf', 'dynamicSforzando1'],
    ['sfz', 'dynamicSforzato'],
    ['fz', 'dynamicForzando'],
    ['rf', 'dynamicRinforzando1'],
    ['rfz', 'dynamicRinforzando2'],
    ['sffz', 'dynamicSforzatoFF'],
    // pf (poco forte / piano-forte) has no single settled reading of its two
    // letters, so its glyph alone is carried, not a fabricated attack.
    ['pf', 'dynamicPF'],
  ])('reads the single accent %s as its glyph', (mark, glyph) => {
    const { measure, warnings } = read(
      inMeasure(direction(`<dynamics><${mark}/></dynamics>`) + note('C')),
    )

    expect(measure?.dynamics[0]?.value).toBeUndefined()
    expect(measure?.dynamics[0]?.accent).toEqual({ attackValue: undefined, glyphs: [glyph] })
    expect(warnings).toEqual([])
  })

  // A two-stage accent states a momentary attack and the level it settles to:
  // fp is a forte attack held at piano. MNX carries the attack as attackValue
  // and the residual as the value.
  test.each([
    ['fp', 'f', 'p', 'dynamicFortePiano'],
    ['sfp', 'f', 'p', 'dynamicSforzandoPiano'],
    ['sfpp', 'f', 'pp', 'dynamicSforzandoPianissimo'],
    ['sfzp', 'f', 'p', 'dynamicSforzatoPiano'],
  ])('reads the two-stage accent %s as attack and residual', (mark, attack, residual, glyph) => {
    const { measure, warnings } = read(
      inMeasure(direction(`<dynamics><${mark}/></dynamics>`) + note('C')),
    )

    expect(measure?.dynamics[0]?.value).toBe(residual)
    expect(measure?.dynamics[0]?.accent).toEqual({ attackValue: attack, glyphs: [glyph] })
    expect(warnings).toEqual([])
  })

  test('writes an accent dynamic the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure(direction('<dynamics><fp/></dynamics>') + note('C')))

    expect(mnx.global.measures[0]).toBeDefined()
    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      value: 'p',
      attackValue: 'f',
      glyphs: ['dynamicFortePiano'],
    })
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes a single accent with a glyph and no value', () => {
    const { mnx } = convertMusicXML(inMeasure(direction('<dynamics><sf/></dynamics>') + note('C')))

    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      glyphs: ['dynamicSforzando1'],
    })
    expect(schemaErrors(mnx)).toEqual([])
  })

  // <other-dynamics> is the wording a source wraps a mark in: "più f", "p
  // dolce". MNX states that wording as the dynamic's prefix and suffix, so the
  // text goes on the mark it qualifies rather than standing on its own.
  test('reads text before a mark as its prefix', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction('<dynamics><other-dynamics>più </other-dynamics><f/></dynamics>') + note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.prefix).toBe('più')
    expect(measure?.dynamics[0]?.value).toBe('f')
    expect(warnings).toEqual([])
  })

  test('reads text after a mark as its suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction('<dynamics><p/><other-dynamics> dolce</other-dynamics></dynamics>') + note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.suffix).toBe('dolce')
    expect(measure?.dynamics[0]?.value).toBe('p')
    expect(warnings).toEqual([])
  })

  test('reads text qualifying an accent as its prefix', () => {
    const { measure } = read(
      inMeasure(
        direction('<dynamics><other-dynamics>poco </other-dynamics><sf/></dynamics>') + note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.prefix).toBe('poco')
    expect(measure?.dynamics[0]?.accent?.glyphs).toEqual(['dynamicSforzando1'])
  })

  // Text sitting between two marks qualifies the one it comes before: "1st
  // time f, 2nd pp" reads as f, then ", 2nd" opening pp.
  test('reads text between two marks as the second one prefix', () => {
    const { measure } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics>1st time </other-dynamics><f/>' +
            '<other-dynamics>, 2nd </other-dynamics><pp/></dynamics>',
        ),
      ),
    )

    expect(measure?.dynamics[0]).toMatchObject({ value: 'f', prefix: '1st time' })
    expect(measure?.dynamics[1]).toMatchObject({ value: 'pp', prefix: ', 2nd' })
    expect(measure?.dynamics[0]?.suffix).toBeUndefined()
  })

  test('joins several texts standing before one mark', () => {
    const { measure } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics>sempre </other-dynamics>' +
            '<other-dynamics>più </other-dynamics><p/></dynamics>',
        ),
      ),
    )

    expect(measure?.dynamics[0]?.prefix).toBe('sempre più')
  })

  test('carries the wording of a mark it both opens and closes', () => {
    const { measure } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics>meno </other-dynamics><f/>' +
            '<other-dynamics> sempre</other-dynamics></dynamics>',
        ),
      ),
    )

    expect(measure?.dynamics[0]).toMatchObject({ prefix: 'meno', suffix: 'sempre', value: 'f' })
  })

  // MNX states prefix and suffix on a dynamic group, and a group states a
  // level. Wording standing alone, with no mark to qualify, has nowhere to go.
  test('reports text with no mark to qualify', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><other-dynamics>sff</other-dynamics></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.message)).toContain(
      'A dynamic wording of "sff", with no dynamic mark to qualify, is not converted yet.',
    )
  })

  // The wording opens the mark that follows it. Where that mark is one the
  // converter passes over, the words go with it rather than sliding onto the
  // next mark along, which the source never stood them in front of.
  test('reports wording qualifying a mark that is not converted', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction('<dynamics><other-dynamics>più </other-dynamics><ffff/><p/></dynamics>') +
          note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.value).toBe('p')
    expect(measure?.dynamics[0]?.prefix).toBeUndefined()
    expect(warnings.map((w) => w.message)).toEqual([
      'A dynamic of "ffff" is not converted yet.',
      'A dynamic wording of "più" is not converted yet, because the "ffff" it qualifies is not.',
    ])
  })

  // An element naming a glyph and holding no text is a mark drawn as that
  // glyph alone, which is notation, not an empty element to pass over.
  test('reports a wording drawn only as a glyph', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics smufl="dynamicSforzatoFF"></other-dynamics>' + '</dynamics>',
        ) + note('C'),
      ),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.message)).toEqual([
      'A dynamic drawn only as the glyph "dynamicSforzatoFF" is not converted yet, because ' +
        'MNX states a glyph for the dynamic mark, not for its wording.',
    ])
  })

  test('reads which side of the staff an accent is placed', () => {
    const { measure } = read(
      inMeasure(
        '<direction placement="above"><direction-type><dynamics><sfz/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.orient).toBe('above')
    expect(measure?.dynamics[0]?.accent?.glyphs).toEqual(['dynamicSforzato'])
  })

  test('passes over an empty wording without reporting it', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><other-dynamics> </other-dynamics></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings).toEqual([])
  })

  // The glyph a source names for its wording is not the group's glyph: that
  // one draws the mark itself, and overwriting it would redraw the dynamic.
  test('reports the glyph named for a wording', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics smufl="dynamicSforzando">più </other-dynamics>' +
            '<f/></dynamics>',
        ),
      ),
    )

    expect(measure?.dynamics[0]?.prefix).toBe('più')
    expect(warnings.map((w) => w.message)).toContain(
      'The glyph named for the dynamic wording "più" is drawn as text instead, because MNX ' +
        'states a glyph for the dynamic mark, not for its wording.',
    )
  })

  test('writes the wording of a dynamic onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(
      inMeasure(
        direction(
          '<dynamics><other-dynamics>più </other-dynamics><f/>' +
            '<other-dynamics> sub.</other-dynamics></dynamics>',
        ) + note('C'),
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toEqual({
      position: { fraction: [0, 1] },
      type: 'immediate',
      value: 'f',
      prefix: 'più',
      suffix: 'sub.',
    })
    expect(schemaErrors(mnx)).toEqual([])
  })
})

describe('tempo', () => {
  test('places a metronome mark on the score measure', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'quarter', dots: 0 }, bpm: 120 },
    ])
  })

  test('reads a dotted beat unit', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><beat-unit-dot/>' +
            '<per-minute>80</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.value).toEqual({ base: 'quarter', dots: 1 })
  })

  test('reports a metronome stated as one note value equalling another', () => {
    const { warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><beat-unit>eighth</beat-unit></metronome>',
        ) + note('C'),
      ),
    )

    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tempo')
  })

  test('rejects a metronome whose beat unit is not a note value', () => {
    let thrown = ''
    try {
      read(
        inMeasure(
          direction(
            '<metronome><beat-unit>triangle</beat-unit><per-minute>90</per-minute></metronome>',
          ) + note('C'),
        ),
      )
    } catch (e) {
      thrown = e instanceof Error ? e.message : ''
    }

    expect(thrown).toContain('is not a note value')
  })

  // MusicXML's per-minute is a string that can be a descriptive word such as
  // "fast" rather than a number. MNX states a tempo as beats per minute, so
  // there is nothing to carry, but a valid marking must not refuse the file.
  test('reports rather than refuses a per-minute given as descriptive text', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>fast</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tempo')
  })

  // An empty <per-minute> prints the beat-unit glyph alone, with the number
  // supplied as adjacent text. It is valid, and refusing the whole file over
  // it would be wrong; MNX has no numeric tempo to carry, so it is dropped.
  test('reports rather than refuses a metronome with an empty per-minute', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute></per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:tempo')
  })

  test('rounds a fractional per-minute to whole beats', () => {
    const { global } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>half</beat-unit><per-minute>63.5</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.bpm).toBe(64)
  })
})

// A segno is the point a D.S. jumps back to. It sits between the notes like a
// tempo, and belongs to the score's measure, not the part it is written in.
describe('segno', () => {
  test('puts a segno on the score measure at where it is written', () => {
    const { global, warnings } = read(inMeasure(note('C') + direction('<segno/>') + note('D')))

    // Written after the first quarter, so a quarter into the measure.
    expect(global?.segno).toEqual({ location: { num: 1, den: 4 }, glyph: undefined })
    expect(warnings).toEqual([])
  })

  test('leaves the segno unset where the measure has none', () => {
    const { global } = read(inMeasure(note('C')))

    expect(global?.segno).toBeUndefined()
  })

  test('keeps the specific glyph the source names', () => {
    const { global } = read(inMeasure(direction('<segno smufl="segnoSerpent1"/>') + note('C')))

    expect(global?.segno).toEqual({ location: { num: 0, den: 1 }, glyph: 'segnoSerpent1' })
  })

  // MNX draws one segno per measure, so a second at another point is reported
  // and the first kept.
  test('reports a second segno at a different point in the measure', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno/>') + note('C') + direction('<segno/>') + note('D')),
    )

    expect(global?.segno).toEqual({ location: { num: 0, den: 1 }, glyph: undefined })
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
    expect(warnings[0]?.message).toContain('more than one segno')
  })

  // Two written at the same point are the same mark, so nothing is lost and
  // nothing is reported.
  test('says nothing about two segnos written at the same point', () => {
    const { warnings } = read(inMeasure(direction('<segno/>') + direction('<segno/>') + note('C')))

    expect(warnings).toEqual([])
  })

  test('writes a segno the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure(direction('<segno/>') + note('C')))

    expect(mnx.global.measures[0]?.segno).toEqual({ location: { fraction: [0, 1] } })
    expect(schemaErrors(mnx)).toEqual([])
  })
})

// The navigation a <sound> carries. A <sound fine> is where a D.S. or D.C.
// repeat stops; a <sound dalsegno> is the jump back to the segno. Both belong
// to the score's measure, like a segno, at the point the <sound> is written.
describe('sound navigation', () => {
  test('puts a fine on the score measure where the <sound fine> sits', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound fine="yes"/>'))

    // Written after the first quarter, so a quarter into the measure.
    expect(global?.fine).toEqual({ location: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  test('reads a <sound fine> written inside a direction', () => {
    const { global, warnings } = read(
      inMeasure(note('C') + '<direction><sound fine="yes"/></direction>'),
    )

    expect(global?.fine).toEqual({ location: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  test('leaves the fine unset where the measure has none', () => {
    const { global } = read(inMeasure(note('C')))

    expect(global?.fine).toBeUndefined()
  })

  test('puts a jump of type segno on the measure for a <sound dalsegno>', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound dalsegno="segno"/>'))

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno', target: 'segno' })
    expect(warnings).toEqual([])
  })

  test('leaves the jump unset where the measure has none', () => {
    const { global } = read(inMeasure(note('C')))

    expect(global?.jump).toBeUndefined()
  })

  // MNX states one fine per measure, so a second at another point is reported
  // and the first kept.
  test('reports a second fine at a different point in the measure', () => {
    const { global, warnings } = read(
      inMeasure('<sound fine="yes"/>' + note('C') + '<sound fine="yes"/>'),
    )

    expect(global?.fine).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => w.element)).toEqual(['fine'])
    expect(warnings[0]?.message).toContain('more than one fine')
  })

  // A jump carries other playback the output cannot hold; the jump converts
  // and the rest is still reported.
  test('reports the playback a <sound dalsegno> carries besides the jump', () => {
    const { global, warnings } = read(
      inMeasure(note('C') + '<sound dalsegno="segno" dynamics="54"/>'),
    )

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno', target: 'segno' })
    expect(warnings.map((w) => w.message)).toEqual([
      'The "dynamics" of a <sound> is not converted yet.',
    ])
  })

  // D.S. al Fine can be written as one <sound> carrying both attributes. Each
  // reaches its own home, and the jump becomes "dsalfine": MusicXML says the
  // al-Fine only through the Fine's presence, not on the dalsegno attribute.
  test('reads a fine and a jump written on the one <sound>', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound fine="yes" dalsegno="segno"/>'))

    expect(global?.fine).toEqual({ location: { num: 1, den: 4 } })
    expect(global?.jump).toEqual({
      location: { num: 1, den: 4 },
      type: 'dsalfine',
      target: 'segno',
    })
    expect(warnings).toEqual([])
  })

  // The al-Fine is the whole score's: a dalsegno jump in one measure and the
  // Fine it returns to in a later measure still make a D.S. al Fine.
  test('upgrades a jump to dsalfine when a later measure carries a Fine', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1">' +
          '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
          note('C') +
          '<sound dalsegno="segno"/></measure>' +
          '<measure number="2">' +
          note('C') +
          '<sound fine="yes"/></measure>' +
          '</part></score-partwise>',
      ),
      warnings,
    )

    expect(score.globalMeasures[0]?.jump).toEqual({
      location: { num: 1, den: 4 },
      type: 'dsalfine',
      target: 'segno',
    })
    expect(score.globalMeasures[1]?.fine).toEqual({ location: { num: 1, den: 4 } })
    expect(warnings.list()).toEqual([])
  })

  // Without a Fine anywhere in the score, a dalsegno jump is a plain dal-segno,
  // not a D.S. al Fine.
  test('leaves a jump a plain segno when the score carries no Fine', () => {
    const { global } = read(inMeasure(note('C') + '<sound dalsegno="segno"/>'))

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno', target: 'segno' })
  })

  // A score can carry two segno signs and a jump back to each. The Fine only
  // stops the jump that returns to a segno before it: replaying from a segno
  // written after the Fine never reaches it, so that jump is a plain dal-segno.
  // Naming the sign is how a source keeps the two apart.
  test('leaves a jump back to a segno written after the Fine a plain segno', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1">' +
          '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
          '<direction><direction-type><segno/></direction-type>' +
          '<sound segno="first"/></direction>' +
          note('C') +
          '</measure>' +
          `<measure number="2">${note('C')}<sound fine="yes"/></measure>` +
          '<measure number="3">' +
          '<direction><direction-type><segno/></direction-type>' +
          '<sound segno="second"/></direction>' +
          note('C') +
          '</measure>' +
          `<measure number="4">${note('C')}<sound dalsegno="second"/></measure>` +
          `<measure number="5">${note('C')}<sound dalsegno="first"/></measure>` +
          '</part></score-partwise>',
      ),
      warnings,
    )

    // Back to the second segno, which stands after the Fine: a plain dal-segno.
    expect(score.globalMeasures[3]?.jump?.type).toBe('segno')
    // Back to the first, which stands before it: a D.S. al Fine.
    expect(score.globalMeasures[4]?.jump?.type).toBe('dsalfine')
  })

  // With one segno the name settles nothing, so the Fine stops the jump
  // whatever either is called.
  test('upgrades a jump against the only segno whatever it is named', () => {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1">' +
          '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
          '<direction><direction-type><segno/></direction-type></direction>' +
          note('C') +
          '</measure>' +
          `<measure number="2">${note('C')}<sound fine="yes"/></measure>` +
          `<measure number="3">${note('C')}<sound dalsegno="whatever"/></measure>` +
          '</part></score-partwise>',
      ),
      warnings,
    )

    expect(score.globalMeasures[2]?.jump?.type).toBe('dsalfine')
  })

  test('writes a fine the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure('<sound fine="yes"/>' + note('C')))

    expect(mnx.global.measures[0]?.fine).toEqual({ location: { fraction: [0, 1] } })
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes a jump the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure('<sound dalsegno="segno"/>' + note('C')))

    expect(mnx.global.measures[0]?.jump).toEqual({ location: { fraction: [0, 1] }, type: 'segno' })
    expect(schemaErrors(mnx)).toEqual([])
  })

  test('writes a dsalfine jump the spec schema accepts', () => {
    const { mnx } = convertMusicXML(inMeasure('<sound fine="yes" dalsegno="segno"/>' + note('C')))

    expect(mnx.global.measures[0]?.jump).toEqual({
      location: { fraction: [0, 1] },
      type: 'dsalfine',
    })
    expect(schemaErrors(mnx)).toEqual([])
  })
})

describe('directions MNX cannot state', () => {
  test('reports a word', () => {
    const { warnings } = read(inMeasure(direction('<words>dolce</words>') + note('C')))

    expect(warnings.map((w) => w.message)).toContain('A <words> direction is not converted yet.')
  })

  test('reports a pedal mark', () => {
    const { warnings } = read(inMeasure(direction('<pedal type="start"/>') + note('C')))

    // MNX has no pedalling of any kind, so this one can never be converted.
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:element')
    expect(warnings.map((w) => w.message)).toContain(
      'A <pedal> direction cannot be expressed in MNX.',
    )
  })

  test('says nothing about a direction it fully converts', () => {
    const { warnings } = read(inMeasure(direction('<dynamics><mf/></dynamics>') + note('C')))

    expect(warnings).toEqual([])
  })
})

// A dynamic sits under a particular hand of a piano part, and MNX states the
// staff on the mark itself. A tempo is the whole score's, so it has no use
// for one.
describe('which staff a direction belongs under', () => {
  const twoStaves = '<attributes><divisions>4</divisions><staves>2</staves></attributes>'
  const noteOn = (staff: string) =>
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    `<type>quarter</type><staff>${staff}</staff></note>`

  function dynamicsOf(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        `<score-partwise><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return { dynamics: score.parts[0]?.measures[0]?.dynamics ?? [], warnings: warnings.list() }
  }

  test('carries the staff a dynamic names', () => {
    const { dynamics, warnings } = dynamicsOf(
      twoStaves +
        noteOn('1') +
        '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
        '<staff>2</staff></direction>',
    )

    expect(dynamics.map((d) => d.staff)).toEqual([2])
    expect(warnings).toEqual([])
  })

  test('leaves it unset where the part has only one staff to name', () => {
    const { dynamics } = dynamicsOf(
      '<attributes><divisions>4</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
        '<type>quarter</type></note>' +
        '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
        '<staff>1</staff></direction>',
    )

    expect(dynamics.map((d) => d.staff)).toEqual([undefined])
  })

  test('rejects a staff the part does not have', () => {
    expect(() =>
      dynamicsOf(
        twoStaves +
          noteOn('1') +
          '<direction><direction-type><dynamics><p/></dynamics></direction-type>' +
          '<staff>3</staff></direction>',
      ),
    ).toThrow('outside the range 1 to 2')
  })
})

// A direction sits where the cursor has reached, and <offset> shifts it from
// there, in divisions. It is routinely negative: a mark written after the
// note it belongs under is pulled back on to it.
describe('an offset moving a direction', () => {
  function at(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return {
      positions: (score.parts[0]?.measures[0]?.dynamics ?? []).map((d) => d.position),
      warnings: warnings.list(),
    }
  }

  const quarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'
  const dynamic = (body: string) =>
    `<direction><direction-type><dynamics><p/></dynamics></direction-type>${body}</direction>`

  test('moves the mark forward by that many divisions', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>2</offset>'))

    // One quarter in, plus two of four divisions, is three eighths.
    expect(positions).toEqual([{ num: 3, den: 8 }])
    expect(warnings).toEqual([])
  })

  test('pulls the mark back where the offset is negative', () => {
    const { positions, warnings } = at(quarter + quarter + dynamic('<offset>-4</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings).toEqual([])
  })

  // MNX counts a position from the start of its measure, so there is nowhere
  // to put a mark an offset drags behind the barline.
  test('leaves the mark where it was where the offset reaches behind the barline', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>-8</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.element)).toEqual(['offset'])
    expect(warnings[0]?.message).toContain('outside its measure')
  })

  // An offset is counted in divisions. Where a file never says how many make
  // a quarter note, the customary one per quarter is assumed and reported.
  test('assumes one division per quarter for an offset before any <divisions>', () => {
    const warnings = new WarningCollector()
    readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `${dynamic('<offset>2</offset>')}</measure></part></score-partwise>`,
      ),
      warnings,
    )

    expect(warnings.list().map((w) => w.code)).toContain('missing:divisions')
  })

  // MusicXML allows a fractional offset. Rounding one would put the mark
  // somewhere the source did not.
  test('leaves the mark where it was where the offset is not a whole number', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>2.5</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.element)).toEqual(['offset'])
    expect(warnings[0]?.message).toContain('not a whole number')
  })
})

// <sound> is a playback element. A tempo it states is playback, not notation:
// MNX's tempo object is always drawn, so emitting one from a <sound> would
// fabricate a metronome the source never displayed. A <metronome> beside it is
// the drawn mark, and the <sound tempo> only echoes it for playback.
describe('the tempo a <sound> states', () => {
  function tempos(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return { tempos: score.globalMeasures[0]?.tempos ?? [], warnings: warnings.list() }
  }

  const quarter =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'

  const soundTempoDropped = 'The "tempo" of a <sound> is not converted yet.'

  test('drops a bare one rather than drawing a metronome the source never showed', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="120"/></direction>' + quarter,
    )

    expect(found).toEqual([])
    expect(warnings.map((w) => w.message)).toContain(soundTempoDropped)
  })

  test('drops one written straight into the measure', () => {
    const { tempos: found, warnings } = tempos(`<sound tempo="88"/>${quarter}`)

    expect(found).toEqual([])
    expect(warnings.map((w) => w.message)).toContain(soundTempoDropped)
  })

  // The two say the same thing, and the metronome is the one that is drawn, so
  // the sound's echo is passed over without a word.
  test('passes over one that only restates a <metronome> beside it', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>half</beat-unit>' +
        '<per-minute>60</per-minute></metronome></direction-type>' +
        '<sound tempo="120"/></direction>' +
        quarter,
    )

    expect(found).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'half', dots: 0 }, bpm: 60 },
    ])
    expect(warnings.map((w) => w.message)).not.toContain(soundTempoDropped)
  })

  // The same mark written twice: the direction draws it, the <sound> beside it
  // repeats it for playback.
  test('passes over one at the same point as a tempo a <direction> already gave', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type></direction>' +
        '<sound tempo="90"/>' +
        quarter,
    )

    expect(found.map((t) => t.bpm)).toEqual([120])
    expect(warnings.map((w) => w.message)).not.toContain(soundTempoDropped)
  })

  test('drops one that falls later in the measure than a drawn metronome', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type></direction>' +
        quarter +
        '<sound tempo="90"/>',
    )

    expect(found.map((t) => t.bpm)).toEqual([120])
    expect(warnings.map((w) => w.message)).toContain(soundTempoDropped)
  })

  test('reports the other playback it carries besides a dropped tempo', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="100" dynamics="71"/></direction>' + quarter,
    )

    expect(found).toEqual([])
    expect(warnings.map((w) => w.message)).toEqual([
      soundTempoDropped,
      'The "dynamics" of a <sound> is not converted yet.',
    ])
  })
})

// A hairpin grows or fades from here to somewhere later, often several
// measures away. MusicXML marks both ends and numbers them so they can be
// matched, exactly as it does a slur; MNX states the pair once, on the end
// where it begins, pointing at the measure where it stops.
describe('hairpins', () => {
  const NOTE =
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
    '<type>quarter</type></note>'

  const wedge = (type: string, number = '1') =>
    `<direction><direction-type><wedge type="${type}" number="${number}"/></direction-type></direction>`

  function readMeasures(...bodies: string[]) {
    const warnings = new WarningCollector()
    const measures = bodies
      .map(
        (body, index) =>
          `<measure number="${String(index + 1)}">` +
          (index === 0 ? '<attributes><divisions>4</divisions></attributes>' : '') +
          `${body}</measure>`,
      )
      .join('')
    const score = readScore(
      parseXmlRoot(`<score-partwise><part id="P1">${measures}</part></score-partwise>`),
      warnings,
    )
    return {
      dynamics: (score.parts[0]?.measures ?? []).map((m) => m.dynamics),
      warnings: warnings.list(),
    }
  }

  test('states a crescendo as a wedge opening out, with where it stops', () => {
    const { dynamics, warnings } = readMeasures(wedge('crescendo') + NOTE, NOTE + wedge('stop'))

    expect(dynamics[0]?.[0]).toEqual({
      position: { num: 0, den: 1 },
      value: undefined,
      wedge: 'increasing',
      end: { measure: 1, position: { num: 1, den: 4 } },
      staff: undefined,
    })
    expect(dynamics[1]).toEqual([])
    expect(warnings).toEqual([])
  })

  test('states a diminuendo as a wedge closing', () => {
    const { dynamics } = readMeasures(wedge('diminuendo') + NOTE + wedge('stop'))

    expect(dynamics[0]?.[0]?.wedge).toBe('decreasing')
    expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
  })

  // Several may be open at once, so each number holds a stack and a stop
  // closes the most recently opened, exactly as a slur does.
  test('matches each hairpin to the stop that carries its number', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo', '1') + wedge('diminuendo', '2') + NOTE,
      NOTE + wedge('stop', '2') + wedge('stop', '1'),
    )

    expect(dynamics[0]?.map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(warnings).toEqual([])
  })

  // MNX allows a gradual mark with no end, and saying a hairpin starts here
  // says more than dropping it would. What is lost is how far it runs.
  test('keeps a hairpin nothing closes, and reports how far it runs is lost', () => {
    const { dynamics, warnings } = readMeasures(wedge('crescendo') + NOTE)

    expect(dynamics[0]?.[0]?.wedge).toBe('increasing')
    expect(dynamics[0]?.[0]?.end).toBeUndefined()
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('nothing ends it')
  })

  test('reports a stop where no hairpin had started', () => {
    const { dynamics, warnings } = readMeasures(NOTE + wedge('stop'))

    expect(dynamics[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('none had started')
  })

  const placedWedge =
    '<direction placement="below"><direction-type><wedge type="crescendo" number="1"/>' +
    '</direction-type></direction>'

  test('reads the side a hairpin is drawn on', () => {
    const { dynamics } = readMeasures(placedWedge + NOTE + wedge('stop'))

    expect(dynamics[0]?.[0]?.orient).toBe('below')
  })

  test('writes the side a hairpin is drawn on onto schema-valid MNX', () => {
    const { mnx } = convertMusicXML(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        placedWedge +
        NOTE +
        wedge('stop') +
        '</measure></part></score-partwise>',
    )

    expect(JSON.stringify(mnx)).toContain('"orient":"below"')
    expect(schemaErrors(mnx)).toEqual([])
  })

  // "continue" marks a point partway along one, which MNX has no need of,
  // since it states only where a hairpin begins and ends.
  test('says nothing about a point partway along one', () => {
    const { warnings } = readMeasures(
      wedge('crescendo') + NOTE,
      wedge('continue') + NOTE + wedge('stop'),
    )

    expect(warnings).toEqual([])
  })

  test('reports a wedge of a type it does not know', () => {
    const { warnings } = readMeasures(wedge('wibble') + NOTE)

    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('not converted yet')
  })

  // MusicXML's document order is not time order: a measure holding two voices
  // is written as one pass per voice with a <backup> between them, so a stop
  // belonging to the first voice is written before a start belonging to the
  // second. Pairing in document order made a hairpin out of two ends that had
  // nothing to do with each other.
  test('pairs the ends the music has together, not the ones written together', () => {
    const voiceOne =
      '<note><voice>1</voice><pitch><step>C</step><octave>4</octave></pitch>' +
      '<duration>4</duration><type>quarter</type></note>'
    const { dynamics, warnings } = readMeasures(
      // Voice 1 fills the measure and its hairpin stops at the halfway point.
      voiceOne +
        voiceOne +
        wedge('stop') +
        '<backup><duration>8</duration></backup>' +
        // Voice 2, written afterwards, opens that hairpin at the start.
        wedge('crescendo') +
        `<note><voice>2</voice><pitch><step>E</step><octave>4</octave></pitch>` +
        `<duration>8</duration><type>half</type></note>`,
    )

    expect(dynamics[0]?.map((d) => [d.wedge, d.position, d.end])).toEqual([
      ['increasing', { num: 0, den: 1 }, { measure: 0, position: { num: 1, den: 2 } }],
    ])
    expect(warnings).toEqual([])
  })

  test('closes a hairpin that ends exactly where the next one begins', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo') + NOTE + wedge('stop') + wedge('diminuendo') + NOTE + wedge('stop'),
    )

    expect(dynamics[0]?.map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(dynamics[0]?.[1]?.end).toEqual({ measure: 0, position: { num: 1, den: 2 } })
    expect(warnings).toEqual([])
  })

  test('reports a wedge that states no type at all', () => {
    const { warnings } = readMeasures(
      '<direction><direction-type><wedge number="1"/></direction-type></direction>' + NOTE,
    )

    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('of type ""')
  })

  test('keeps the staff a hairpin belongs under', () => {
    const { dynamics } = readMeasures(
      '<attributes><staves>2</staves></attributes>' +
        '<direction><direction-type><wedge type="crescendo"/></direction-type>' +
        '<staff>2</staff></direction>' +
        NOTE +
        wedge('stop'),
    )

    expect(dynamics[0]?.[0]?.staff).toBe(2)
  })
})
