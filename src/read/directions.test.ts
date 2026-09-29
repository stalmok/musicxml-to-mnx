// A <direction> sits between the notes, at wherever the cursor has reached. A
// dynamic goes on the part's measure at that position; a metronome mark goes
// on the score's measure, since tempo is the whole score's. What MNX cannot
// state, like a word or a pedal, is reported.

import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from '../warnings.js'
import { parseXmlRoot } from '../xml/parse.js'
import { readScore } from './score.js'

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

// A <backup> can carry the cursor before the measure starts, and a <forward>
// bring it back. A direction written out there sits at the measure start,
// which is the earliest place there is.
describe('a direction written before the measure starts', () => {
  test('sits at the measure start', () => {
    const { measure } = read(
      inMeasure(
        '<backup><duration>16</duration></backup>' +
          direction('<dynamics><f/></dynamics>') +
          '<forward><duration>16</duration></forward>' +
          note('C'),
      ),
    )

    expect(measure?.dynamics).toEqual([{ position: { num: 0, den: 1 }, value: 'f' }])
  })
})

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

    expect(measure?.dynamics[0]?.placement).toBe('above')
  })

  test('writes the dynamic side onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      inMeasure(
        '<direction placement="below"><direction-type><dynamics><p/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"placement":"below"')
  })

  test.each([
    'pppppp',
    'ppppp',
    'pppp',
    'ppp',
    'pp',
    'p',
    'mp',
    'mf',
    'f',
    'ff',
    'fff',
    'ffff',
    'fffff',
    'ffffff',
  ])('reads %s', (value) => {
    const { measure, warnings } = read(
      inMeasure(direction(`<dynamics><${value}/></dynamics>`) + note('C')),
    )

    expect(measure?.dynamics[0]?.value).toBe(value)
    expect(warnings).toEqual([])
  })

  test('writes an extreme dynamic the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><pppp/></dynamics>') + note('C')))

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]?.value).toBe('pppp')
  })

  // Every dynamic element MusicXML names converts, so only an element
  // from outside the format reaches the report.
  test('reports a dynamic mark it does not know', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><fffffff/></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.message)).toContain('A dynamic of "fffffff" is not converted yet.')
  })

  // The accent dynamics (sforzando and its family) are spelled out: the value
  // is the level of the attack, and the letters around it go as the accent's
  // prefix and suffix, which is what keeps sf, fz and rfz apart. The combined
  // SMuFL glyph is carried besides, so the mark is drawn as written.
  test.each([
    ['sf', 'f', 's', '', 'dynamicSforzando1'],
    ['sfz', 'f', 's', 'z', 'dynamicSforzato'],
    ['fz', 'f', '', 'z', 'dynamicForzando'],
    ['rf', 'f', 'r', '', 'dynamicRinforzando1'],
    ['rfz', 'f', 'r', 'z', 'dynamicRinforzando2'],
    ['sffz', 'ff', 's', 'z', 'dynamicSforzatoFF'],
  ])('reads the single accent %s as its letters', (mark, value, prefix, suffix, glyph) => {
    const { measure, warnings } = read(
      inMeasure(direction(`<dynamics><${mark}/></dynamics>`) + note('C')),
    )

    expect(measure?.dynamics[0]?.value).toBe(value)
    expect(measure?.dynamics[0]?.accent).toEqual({
      residualValue: undefined,
      prefix,
      suffix,
      glyphs: [glyph],
    })
    expect(warnings).toEqual([])
  })

  // pf (poco forte / piano-forte) has no single settled reading of its two
  // letters, and the accent prefixes MNX names stop at s and r, so only its
  // glyph is carried.
  test('reads pf as its glyph alone', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><pf/></dynamics>') + note('C')),
    )

    expect(measure?.dynamics[0]?.value).toBeUndefined()
    expect(measure?.dynamics[0]?.accent).toEqual({
      residualValue: undefined,
      prefix: undefined,
      suffix: undefined,
      glyphs: ['dynamicPF'],
    })
    expect(warnings).toEqual([])
  })

  // A two-stage accent states a momentary attack and the level it settles to:
  // fp is a forte attack held at piano. MNX carries the attack as the value
  // and the level it settles to as residualValue.
  test.each([
    ['fp', 'f', 'p', '', '', 'dynamicFortePiano'],
    ['sfp', 'f', 'p', 's', '', 'dynamicSforzandoPiano'],
    ['sfpp', 'f', 'pp', 's', '', 'dynamicSforzandoPianissimo'],
    ['sfzp', 'f', 'p', 's', 'z', 'dynamicSforzatoPiano'],
  ])(
    'reads the two-stage accent %s as attack and residual',
    (mark, attack, residual, prefix, suffix, glyph) => {
      const { measure, warnings } = read(
        inMeasure(direction(`<dynamics><${mark}/></dynamics>`) + note('C')),
      )

      expect(measure?.dynamics[0]?.value).toBe(attack)
      expect(measure?.dynamics[0]?.accent).toEqual({
        residualValue: residual,
        prefix,
        suffix,
        glyphs: [glyph],
      })
      expect(warnings).toEqual([])
    },
  )

  // MNX reads an absent accentPrefix as "s" and an absent accentSuffix as
  // "z", so a mark without those letters must say so, and a mark with them
  // may leave them to the defaults.
  test('writes an accent dynamic the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><fp/></dynamics>') + note('C')))

    expect(mnx.global.measures[0]).toBeDefined()
    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      value: 'f',
      residualValue: 'p',
      accentPrefix: '',
      accentSuffix: '',
      glyphs: ['dynamicFortePiano'],
    })
  })

  test('leaves the accent letters MNX defaults unstated', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><sfz/></dynamics>') + note('C')))

    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      value: 'f',
      glyphs: ['dynamicSforzato'],
    })
  })

  test('states the accent letters that differ from the defaults', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><sf/></dynamics>') + note('C')))

    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      value: 'f',
      accentSuffix: '',
      glyphs: ['dynamicSforzando1'],
    })
  })

  test('writes a glyph-only accent with no value', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><pf/></dynamics>') + note('C')))

    const dynamic = mnx.parts[0]?.measures[0]?.dynamics?.[0]
    expect(dynamic).toEqual({
      position: { fraction: [0, 1] },
      type: 'accent',
      glyphs: ['dynamicPF'],
    })
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

  // MNX requires only a position and a type of a dynamic group, so wording
  // standing alone converts as a group with no level: the words are drawn
  // where the source drew them, and no level the source never wrote is
  // stated.
  test('converts wording standing alone as a mark-less group', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><other-dynamics>sff</other-dynamics></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([{ position: { num: 0, den: 1 }, prefix: 'sff' }])
    expect(warnings).toEqual([])
  })

  test('writes standalone wording onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        direction('<dynamics><other-dynamics>dolce</other-dynamics></dynamics>') + note('C'),
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toEqual({
      position: { fraction: [0, 1] },
      type: 'immediate',
      prefix: 'dolce',
    })
    expect(warnings).toEqual([])
  })

  // An edge that writes no number is number 1.
  test.each([
    ['<wedge type="crescendo"/>', '<wedge type="stop" number="1"/>'],
    ['<wedge type="crescendo" number="1"/>', '<wedge type="stop"/>'],
  ])('joins %s to %s', (start, stop) => {
    const { measure, warnings } = read(
      inMeasure(
        `<direction><direction-type>${start}</direction-type></direction>` +
          note('C') +
          `<direction><direction-type>${stop}</direction-type></direction>`,
      ),
    )

    expect(measure?.dynamics[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(warnings).toEqual([])
  })

  // The wording beside a wedge in the same <direction-type> qualifies the
  // hairpin: "cresc." is the crescendo's own wording, and MNX puts a prefix
  // on a gradual group like on any other.
  test('carries wording beside a wedge onto the hairpin', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
          '<wedge type="crescendo"/>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        prefix: 'cresc.',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toEqual([])
  })

  test('carries wording after a wedge as the hairpin suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<wedge type="crescendo"/>' +
          '<dynamics><other-dynamics> molto</other-dynamics></dynamics>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
      ),
    )

    expect(measure?.dynamics[0]?.wedge).toBe('increasing')
    expect(measure?.dynamics[0]?.suffix).toBe('molto')
    expect(warnings).toEqual([])
  })

  // Wording written beside a hairpin's closing edge trails the mark it
  // qualifies: "smorz." at the end of a diminuendo is the hairpin's own
  // wording, so it goes over as the suffix of the hairpin that stops there
  // rather than standing alone.
  test('carries wording before a stop wedge as the hairpin suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type><wedge type="diminuendo"/></direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>smorz.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'decreasing',
        suffix: 'smorz.',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toEqual([])
  })

  // Wording whose stop closed no hairpin stands on its own, at the point the
  // source drew it. The marks of a measure are read in document order, which
  // a <backup> takes back to an earlier point, so one drawn later can belong
  // before the marks already read.
  test('puts wording standing alone before a mark drawn later in the measure', () => {
    const { measure } = read(
      inMeasure(
        note('C') +
          direction('<dynamics><f/></dynamics>') +
          note('D') +
          '<backup><duration>8</duration></backup>' +
          '<direction><direction-type>' +
          '<wedge type="stop"/>' +
          '<dynamics><other-dynamics>morendo</other-dynamics></dynamics>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics.map((d) => [d.position, d.prefix ?? d.value])).toEqual([
      [{ num: 0, den: 1 }, 'morendo'],
      [{ num: 1, den: 4 }, 'f'],
    ])
  })

  test('carries wording after a stop wedge as the hairpin suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<wedge type="stop"/>' +
          '<dynamics><other-dynamics>dolce</other-dynamics></dynamics>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'dolce',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toEqual([])
  })

  test('writes the closing wording onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<direction><direction-type><wedge type="diminuendo"/></direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>smorz.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics).toHaveLength(1)
    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toMatchObject({
      type: 'gradual',
      suffix: 'smorz.',
    })
    expect(warnings).toEqual([])
  })

  // A stop that matches no start closes nothing, so the wording beside it
  // stands alone, and the stray stop is reported.
  test('keeps wording beside a stray stop standing alone', () => {
    const { measure, warnings } = read(
      inMeasure(
        note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>dim.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([{ position: { num: 1, den: 4 }, prefix: 'dim.' }])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops where none had started, and is not carried over.',
    ])
  })

  // The words stand alone only once the pairing has run, which is after the
  // rest of the measure is read. They belong where the source drew them, so
  // they go in at their position rather than after everything read later.
  test('places wording that stands alone at its own position in the measure', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<wedge type="crescendo"/>' +
          '<dynamics><other-dynamics>molto</other-dynamics></dynamics>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>' +
          note('D') +
          direction('<dynamics><f/></dynamics>'),
      ),
    )

    expect(measure?.dynamics.map((d) => d.position)).toEqual([
      { num: 0, den: 1 },
      { num: 1, den: 4 },
      { num: 1, den: 2 },
    ])
    expect(measure?.dynamics[1]?.prefix).toBe('cresc.')
    expect(warnings).toEqual([])
  })

  // The words are written at a closing edge, so they stay with that edge even
  // where it closes nothing. They are not carried on to the next mark, which
  // the source wrote for itself.
  test('keeps wording at a stray stop off the mark that follows it', () => {
    const { measure, warnings } = read(
      inMeasure(
        note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>dim.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '<dynamics><p/></dynamics>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      { position: { num: 1, den: 4 }, value: 'p' },
      { position: { num: 1, den: 4 }, prefix: 'dim.' },
    ])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops where none had started, and is not carried over.',
    ])
  })

  test('writes wording standing alone onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<direction placement="above"><direction-type>' +
          '<wedge type="crescendo"/>' +
          '<dynamics><other-dynamics>molto</other-dynamics></dynamics>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction placement="above"><direction-type>' +
          '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[1]).toMatchObject({
      type: 'immediate',
      prefix: 'cresc.',
      placement: 'above',
    })
    expect(warnings).toEqual([])
  })

  // A source can word both edges of one hairpin. The suffix set where it
  // started stays, and the closing words stand alone rather than overwrite it.
  test('keeps closing wording standing alone when the hairpin already has a suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<wedge type="crescendo"/>' +
          '<dynamics><other-dynamics> molto</other-dynamics></dynamics>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'molto',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
      { position: { num: 1, den: 4 }, prefix: 'cresc.' },
    ])
    expect(warnings).toEqual([])
  })

  test('keeps wording after the stop standing alone when the hairpin already has a suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<wedge type="crescendo"/>' +
          '<dynamics><other-dynamics> molto</other-dynamics></dynamics>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<wedge type="stop"/>' +
          '<dynamics><other-dynamics>sempre</other-dynamics></dynamics>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'molto',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
      { position: { num: 1, den: 4 }, prefix: 'sempre' },
    ])
    expect(warnings).toEqual([])
  })

  // A source can word both sides of one closing edge. The hairpin takes the
  // first, since one mark carries one suffix, and the second stands alone.
  test('keeps the second wording at one closing edge standing alone', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>' +
          note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>dim.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '<dynamics><other-dynamics>poco</other-dynamics></dynamics>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([
      {
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'dim.',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
      { position: { num: 1, den: 4 }, prefix: 'poco' },
    ])
    expect(warnings).toEqual([])
  })

  // MusicXML allows <dynamics> more than once in one <direction-type>, so
  // the wording and the mark it opens may sit in sibling blocks.
  test('carries wording onto the mark in a sibling dynamics block', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction><direction-type>' +
          '<dynamics><other-dynamics>più </other-dynamics></dynamics>' +
          '<dynamics><f/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(measure?.dynamics).toEqual([{ position: { num: 0, den: 1 }, value: 'f', prefix: 'più' }])
    expect(warnings).toEqual([])
  })

  // The attributes of a <direction-type> child are swept like any other
  // reader's: a metronome mark drawn in parentheses has no home in MNX's
  // tempo, and a hairpin starting from nothing none in its group.
  test('reports a parenthesized metronome mark', () => {
    const { warnings } = read(
      inMeasure(
        direction(
          '<metronome parentheses="yes"><beat-unit>quarter</beat-unit>' +
            '<per-minute>120</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:attribute'])
    expect(warnings[0]?.message).toBe(
      'The "parentheses" attribute of a <metronome> cannot be expressed in MNX.',
    )
  })

  test('reports a niente hairpin', () => {
    const { warnings } = read(
      inMeasure(
        '<direction><direction-type><wedge type="crescendo" niente="yes"/>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unsupported:attribute'])
    expect(warnings[0]?.message).toBe('The "niente" attribute of a <wedge> is not converted yet.')
  })

  test('writes the hairpin wording onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        '<direction><direction-type>' +
          '<dynamics><other-dynamics>dim. </other-dynamics></dynamics>' +
          '<wedge type="diminuendo"/>' +
          '</direction-type></direction>' +
          note('C') +
          '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toMatchObject({
      type: 'gradual',
      prefix: 'dim.',
    })
    expect(warnings).toEqual([])
  })

  // The wording opens the mark that follows it. Where that mark is one the
  // converter passes over, the words go with it rather than sliding onto the
  // next mark along, which the source never stood them in front of.
  test('reports wording qualifying a mark that is not converted', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction('<dynamics><other-dynamics>più </other-dynamics><fffffff/><p/></dynamics>') +
          note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.value).toBe('p')
    expect(measure?.dynamics[0]?.prefix).toBeUndefined()
    expect(warnings.map((w) => w.message)).toEqual([
      'A dynamic of "fffffff" is not converted yet.',
      'A dynamic wording of "più" is not converted yet, because the "fffffff" it qualifies is not.',
    ])
  })

  // An element naming a glyph and holding no text is a mark drawn as that
  // glyph alone, which is notation, not an empty element to pass over. It is
  // a converter gap, not a format limit: a group with no level can state
  // glyphs.
  test('reports a wording drawn only as a glyph', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction(
          '<dynamics><other-dynamics smufl="dynamicSforzatoFF"></other-dynamics>' + '</dynamics>',
        ) + note('C'),
      ),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
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

    expect(measure?.dynamics[0]?.placement).toBe('above')
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
  // It is a format limit: the schema has nowhere to state how the words are
  // drawn.
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
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:wording-glyph'])
    expect(warnings.map((w) => w.message)).toContain(
      'The glyph named for the dynamic wording "più" is drawn as text instead, because MNX ' +
        'states a glyph for the dynamic mark, not for its wording.',
    )
  })

  test('writes the wording of a dynamic onto schema-valid MNX', () => {
    const { mnx } = convertValid(
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

  // A direction type is read through a reader of its own, so a child its
  // reader passed over is reported rather than left out of the report.
  test('reports a metronome child nothing reads', () => {
    const { warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute>' +
            '<metronome-arrows/></metronome>',
        ) + note('C'),
      ),
    )

    expect(warnings.map((w) => w.message)).toContain('<metronome-arrows> is not converted yet.')
  })

  // The source states "quarter tied to eighth = 60", which is a beat unit MNX
  // has no way to state. Reading the first beat unit alone would put
  // "quarter = 60" in the output, a third away from the tempo the source
  // wrote, so the whole mark is dropped and reported instead.
  test('drops a beat unit tied to a second one, and reports it once', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit>' +
            '<beat-unit-tied><beat-unit>eighth</beat-unit></beat-unit-tied>' +
            '<per-minute>60</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
  })

  // The mark is dropped whole, so its parts go with it. Reporting the dot as
  // well would report one loss twice, the second time as a converter gap.
  test('reports a dropped metronome once, not once for each part of it', () => {
    const { warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><beat-unit-dot/>' +
            '<per-minute></per-minute><metronome-arrows/></metronome>',
        ) + note('C'),
      ),
    )

    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
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

  test('reports a metronome stated as one note equalling another, once', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><metronome-note><metronome-type>quarter</metronome-type></metronome-note>' +
            '<metronome-relation>equals</metronome-relation>' +
            '<metronome-note><metronome-type>eighth</metronome-type></metronome-note></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
  })

  // Exporters leave <beat-unit> empty where the mark carries no note glyph.
  test.each(['triangle', ''])('reports rather than refuses a beat unit of "%s"', (written) => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          `<metronome><beat-unit>${written}</beat-unit><per-minute>90</per-minute></metronome>`,
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
    expect(warnings[0]?.message).toContain('is not a note value')
  })

  // MusicXML's per-minute is a string that can be a descriptive word such as
  // "fast" rather than a number. MNX states a tempo as beats per minute, so
  // there is nothing to carry. The marking is valid, so the file converts.
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

  // MusicXML's per-minute is a string, and JavaScript reads several of its
  // spellings as numbers that the source never meant: "0x10" is a word, not
  // sixteen beats per minute. Only a plain decimal number is a tempo.
  test.each(['0x10', '0b101', '0o17', '1_000', 'Infinity', '1e3'])(
    'reports a per-minute of %s, which is not written as a decimal number',
    (written) => {
      const { global, warnings } = read(
        inMeasure(
          direction(
            `<metronome><beat-unit>quarter</beat-unit><per-minute>${written}</per-minute></metronome>`,
          ) + note('C'),
        ),
      )

      expect(global?.tempos).toEqual([])
      expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
    },
  )

  // The spellings a source does mean as a number, which stay carried.
  test.each([
    ['80', 80],
    ['+80', 80],
    ['.5', 0.5],
    ['76.5', 76.5],
    ['0.4', 0.4],
  ])('carries a per-minute of %s', (written, expected) => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          `<metronome><beat-unit>quarter</beat-unit><per-minute>${written}</per-minute></metronome>`,
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.bpm).toBe(expected)
    expect(warnings).toEqual([])
  })

  // MNX's bpm is a number above zero, so zero itself has nothing to carry.
  test.each(['0', '-60'])('reports a per-minute of %s, which is not above zero', (written) => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          `<metronome><beat-unit>quarter</beat-unit><per-minute>${written}</per-minute></metronome>`,
        ) + note('C'),
      ),
    )

    expect(global?.tempos).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:tempo'])
  })

  // An empty <per-minute> prints the beat-unit glyph alone, with the number
  // supplied as adjacent text. It is valid, so the file converts. MNX has no
  // number to carry, so the mark is dropped.
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
    // Reported as the missing number it is, rather than as a tempo written
    // in a word the converter cannot read.
    expect(warnings[0]?.message).toBe(
      'A <metronome> with no beats-per-minute number cannot be expressed in MNX, ' +
        'which states a tempo as beats per minute.',
    )
  })

  // MNX states beats per minute as a number, so a source that writes a
  // fraction of one is carried as it stands.
  test('carries a fractional per-minute as it is written', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>half</beat-unit><per-minute>63.5</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.bpm).toBe(63.5)
    expect(warnings).toEqual([])
  })

  test('writes a fractional tempo onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>76.5</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(JSON.stringify(mnx)).toContain('"bpm":76.5')
  })

  test('carries a per-minute below one half', () => {
    const { global, warnings } = read(
      inMeasure(
        direction(
          '<metronome><beat-unit>quarter</beat-unit><per-minute>0.4</per-minute></metronome>',
        ) + note('C'),
      ),
    )

    expect(global?.tempos[0]?.bpm).toBe(0.4)
    expect(warnings).toEqual([])
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

  test('keeps the color the source draws the sign in', () => {
    const { global, warnings } = read(inMeasure(direction('<segno color="#FF0000"/>') + note('C')))

    expect(global?.segno?.color).toBe('#FF0000')
    expect(warnings).toEqual([])
  })

  // MusicXML writes an alpha channel first, as #AARRGGBB. An alpha of FF is
  // fully opaque, which is what a color without one already means.
  test('converts a fully opaque alpha as the plain color it is', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno color="#FFFF0000"/>') + note('C')),
    )

    expect(global?.segno?.color).toBe('#FF0000')
    expect(warnings).toEqual([])
  })

  // MNX's color has no alpha form, so a translucent color is converted opaque
  // and the alpha is reported.
  test('reports an alpha channel and converts the color opaque', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno color="#80FF0000"/>') + note('C')),
    )

    expect(global?.segno?.color).toBe('#FF0000')
    expect(warnings.map((w) => w.code)).toEqual(['unrepresentable:color'])
    expect(warnings[0]?.element).toBe('color')
  })

  test('reports a color that is not a MusicXML color, converting none', () => {
    const { global, warnings } = read(inMeasure(direction('<segno color="red"/>') + note('C')))

    expect(global?.segno?.color).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
    expect(warnings[0]?.element).toBe('color')
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

  // Two at the same point drawn differently are two claims about the one sign
  // MNX states, not a restatement, so the second is reported like one at
  // another point.
  test('reports a second segno at the same point drawn in another color', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno color="#FF0000"/>') + direction('<segno/>') + note('C')),
    )

    expect(global?.segno?.color).toBe('#FF0000')
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
    expect(warnings[0]?.message).toContain('more than one segno')
  })

  test('reports a second segno at the same point drawn as another glyph', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno smufl="segnoSerpent1"/>') + direction('<segno/>') + note('C')),
    )

    expect(global?.segno?.glyph).toBe('segnoSerpent1')
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
    expect(warnings[0]?.message).toContain('more than one segno')
  })

  test('writes a segno the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(direction('<segno/>') + note('C')))

    expect(mnx.global.measures[0]?.segno).toEqual({ location: { fraction: [0, 1] } })
  })

  test('writes a segno with its color the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(direction('<segno color="#FF0000"/>') + note('C')))

    expect(mnx.global.measures[0]?.segno).toEqual({
      location: { fraction: [0, 1] },
      color: '#FF0000',
    })
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

  // MusicXML writes the fine as "yes", or as the number of divisions the final
  // note sounds for. The number is playback, and the Fine it marks is the
  // notation, so the mark converts and the number is passed over.
  // Every spelling of a decimal XML allows, since the source picks one.
  test.each(['8', '12', '7.5', '8.', '.5', '.25', '+8'])(
    'puts a fine on the measure for a <sound fine> written as "%s"',
    (duration) => {
      const { global, warnings } = read(inMeasure(note('C') + `<sound fine="${duration}"/>`))

      expect(global?.fine).toEqual({ location: { num: 1, den: 4 } })
      expect(warnings).toEqual([])
    },
  )

  test('reports a <sound fine> with text after the duration', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound fine="8x"/>'))

    expect(global?.fine).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['unresolved:attribute-value'])
  })

  // Anything else is a value MusicXML does not define for the attribute.
  // Reading a Fine out of it would mark the piece as ending where the source
  // did not say it does, so it is reported and no Fine is written.
  test('reports a <sound fine> whose value is neither "yes" nor a duration', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound fine="no"/>'))

    expect(global?.fine).toBeUndefined()
    expect(warnings).toMatchObject([
      {
        code: 'unresolved:attribute-value',
        message: 'The "fine" of a <sound> is "no", which is neither "yes" nor a duration.',
        element: 'sound',
        attribute: 'fine',
      },
    ])
  })

  test('puts a jump of type segno on the measure for a <sound dalsegno>', () => {
    const { global, warnings } = read(inMeasure(note('C') + '<sound dalsegno="segno"/>'))

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno' })
    expect(warnings).toEqual([])
  })

  test('leaves the jump unset where the measure has none', () => {
    const { global } = read(inMeasure(note('C')))

    expect(global?.jump).toBeUndefined()
  })

  // A <sound> is written either on its own or inside a <direction>, which is
  // where an exporter puts it beside the words that draw the instruction. The
  // two go by different paths.
  test('takes the jump from a <sound dalsegno> written inside a <direction>', () => {
    const { global } = read(
      inMeasure(
        note('C') +
          '<direction><direction-type><segno/></direction-type>' +
          '<sound dalsegno="segno"/></direction>',
      ),
    )

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno' })
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

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno' })
    expect(warnings.map((w) => w.message)).toEqual([
      'The "dynamics" of a <sound> cannot be expressed in MNX.',
    ])
  })

  // A <sound dynamics> is a playback velocity, and the schema's perform
  // options hold nothing. The <dynamics> element of the same name does have a
  // home.
  test('reports a <sound dynamics> as a velocity MNX cannot state', () => {
    const { warnings } = read(inMeasure(note('C') + '<sound dynamics="71"/>'))

    expect(warnings).toMatchObject([
      {
        code: 'unrepresentable:attribute',
        message: 'The "dynamics" of a <sound> cannot be expressed in MNX.',
        element: 'sound',
        attribute: 'dynamics',
      },
    ])
  })

  // The rest of the playback the schema has nowhere for: the stereo field and
  // the height above the listener, the three piano pedals, the plucking, the
  // coda sign, and the name a segno is called by.
  test('reports the playback a <sound> carries that MNX cannot state', () => {
    const carried =
      'coda="c" pan="0" elevation="0" damper-pedal="yes" soft-pedal="no" ' +
      'sostenuto-pedal="no" pizzicato="yes" segno="A"'
    const { warnings } = read(inMeasure(note('C') + `<sound ${carried}/>`))

    expect(warnings.map((w) => w.code)).toEqual(Array<string>(8).fill('unrepresentable:attribute'))
    expect(warnings.map((w) => w.attribute)).toEqual([
      'coda',
      'pan',
      'elevation',
      'damper-pedal',
      'soft-pedal',
      'sostenuto-pedal',
      'pizzicato',
      'segno',
    ])
  })

  // The schema does hold a tempo. What stops a <sound tempo> being written is
  // that MNX always draws one, so it is a converter gap rather than a limit
  // of the format.
  test('reports a <sound tempo> as a gap, not as a format limit', () => {
    const { warnings } = read(inMeasure(note('C') + '<sound tempo="100"/>'))

    expect(warnings.map((w) => w.code)).toEqual(['unsupported:attribute'])
  })

  // MNX's jump-type has only "segno" and "dsalfine", so the D.C. and coda
  // navigation a <sound> carries has no home.
  test('reports the D.C. and coda navigation of a <sound>, which MNX cannot state', () => {
    const { warnings } = read(
      inMeasure(note('C') + '<sound dacapo="yes"/>' + note('D') + '<sound tocoda="coda"/>'),
    )

    expect(warnings.map((w) => w.code)).toEqual([
      'unrepresentable:attribute',
      'unrepresentable:attribute',
    ])
    expect(warnings.map((w) => w.message)).toEqual([
      'The "dacapo" of a <sound> cannot be expressed in MNX.',
      'The "tocoda" of a <sound> cannot be expressed in MNX.',
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
    })
    expect(score.globalMeasures[1]?.fine).toEqual({ location: { num: 1, den: 4 } })
    expect(warnings.list()).toEqual([])
  })

  // Without a Fine anywhere in the score, a dalsegno jump is a plain dal-segno,
  // not a D.S. al Fine.
  test('leaves a jump a plain segno when the score carries no Fine', () => {
    const { global } = read(inMeasure(note('C') + '<sound dalsegno="segno"/>'))

    expect(global?.jump).toEqual({ location: { num: 1, den: 4 }, type: 'segno' })
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
    const { mnx } = convertValid(inMeasure('<sound fine="yes"/>' + note('C')))

    expect(mnx.global.measures[0]?.fine).toEqual({ location: { fraction: [0, 1] } })
  })

  test('writes a jump the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure('<sound dalsegno="segno"/>' + note('C')))

    expect(mnx.global.measures[0]?.jump).toEqual({ location: { fraction: [0, 1] }, type: 'segno' })
  })

  test('writes a dsalfine jump the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure('<sound fine="yes" dalsegno="segno"/>' + note('C')))

    expect(mnx.global.measures[0]?.jump).toEqual({
      location: { fraction: [0, 1] },
      type: 'dsalfine',
    })
  })
})

describe('directions MNX cannot state', () => {
  test('reports a word', () => {
    const { warnings } = read(inMeasure(direction('<words>dolce</words>') + note('C')))

    // MNX's only free text is a dynamic's wording and the lyrics, so a text
    // direction can never be converted.
    expect(warnings.map((w) => w.code)).toContain('unrepresentable:element')
    expect(warnings.map((w) => w.message)).toContain(
      'A <words> direction cannot be expressed in MNX.',
    )
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

  // MusicXML allows a fractional offset, and rounding one would move the
  // mark. "2.5" fails both halves of the guard. "2.0" is a safe integer the
  // regex refuses. Twenty digits pass the regex but cannot be read back
  // exactly.
  test.each(['2.5', '2.0', '99999999999999999999'])(
    'leaves the mark where it was where the offset is "%s"',
    (written) => {
      const { positions, warnings } = at(quarter + dynamic(`<offset>${written}</offset>`))

      expect(positions).toEqual([{ num: 1, den: 4 }])
      expect(warnings.map((w) => w.element)).toEqual(['offset'])
      expect(warnings[0]?.message).toContain('not a whole number')
    },
  )

  // The other end of the bar is only knowable once a time signature is in
  // force. Without one, an offset running forward is applied whatever it
  // says, because there is nothing to say it has left the measure.
  function inTime(body: string) {
    const warnings = new WarningCollector()
    const score = readScore(
      parseXmlRoot(
        '<score-partwise><part id="P1"><measure number="1">' +
          '<attributes><divisions>4</divisions>' +
          '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
          `${body}</measure></part></score-partwise>`,
      ),
      warnings,
    )
    return {
      positions: (score.parts[0]?.measures[0]?.dynamics ?? []).map((d) => d.position),
      warnings: warnings.list(),
    }
  }

  // The start of the measure is inside it, not before it. The guard is
  // tested there as well as below it.
  test('applies an offset that reaches exactly the start of the bar', () => {
    const { positions, warnings } = inTime(quarter + dynamic('<offset>-4</offset>'))

    expect(positions).toEqual([{ num: 0, den: 1 }])
    expect(warnings).toEqual([])
  })

  test('applies an offset that stays inside the bar', () => {
    const { positions, warnings } = inTime(quarter + dynamic('<offset>2</offset>'))

    expect(positions).toEqual([{ num: 3, den: 8 }])
    expect(warnings).toEqual([])
  })

  // The barline itself is the last position in the measure, not past it.
  test('applies an offset that reaches exactly the end of the bar', () => {
    const { positions, warnings } = inTime(quarter + dynamic('<offset>4</offset>'))

    expect(positions).toEqual([{ num: 1, den: 2 }])
    expect(warnings).toEqual([])
  })

  test('leaves the mark where it was where the offset carries it past the bar', () => {
    const { positions, warnings } = inTime(quarter + dynamic('<offset>8</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.element)).toEqual(['offset'])
    expect(warnings[0]?.message).toContain('outside its measure')
  })

  // A time signature stated partway through the measure is the next
  // measure's, so the bar still ends where the one it opened with says.
  test('measures the bar by the time signature it opens with', () => {
    const later = '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>'
    const { positions, warnings } = inTime(quarter + later + dynamic('<offset>8</offset>'))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => w.code)).toEqual([
      'unsupported:element',
      'unrepresentable:mid-measure-time',
    ])
  })

  // Before any time signature there is no end to have passed, so the same
  // offset is applied rather than refused.
  test('applies an offset past two beats where no time signature is in force', () => {
    const { positions, warnings } = at(quarter + dynamic('<offset>8</offset>'))

    expect(positions).toEqual([{ num: 3, den: 4 }])
    expect(warnings).toEqual([])
  })
})

// <sound> is a playback element. A tempo it states is playback, not notation:
// MNX's tempo object is always drawn, so writing one from a <sound> would draw
// a metronome mark the source does not show. A <metronome> beside it is the
// drawn mark, and the <sound tempo> only echoes it for playback.
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
    // The report is written once the part is whole, so the measure it names
    // comes from the walk rather than from the element.
    expect(warnings.find((one) => one.message === soundTempoDropped)?.context.measure).toBe(1)
  })

  test('drops one written straight into the measure', () => {
    const { tempos: found, warnings } = tempos(`<sound tempo="88"/>${quarter}`)

    expect(found).toEqual([])
    expect(warnings.map((w) => w.message)).toContain(soundTempoDropped)
  })

  // The two say the same thing, and the metronome is the one that is drawn.
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
        '<sound tempo="120"/>' +
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

  // The decision on the tempo waits until every part is read, and the report
  // reads in document order, so it is reported at the place the <sound> kept:
  // beside the playback the same element carries, in the order written.
  test('reports the other playback it carries besides a dropped tempo', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="100" dynamics="71"/></direction>' + quarter,
    )

    expect(found).toEqual([])
    expect(warnings.map((w) => w.message)).toEqual([
      soundTempoDropped,
      'The "dynamics" of a <sound> cannot be expressed in MNX.',
    ])
  })

  // Deciding it needs the whole score, and the losses read after it must not
  // therefore come before it in the report.
  test('reports one before the losses read after it', () => {
    const { warnings } = tempos(
      '<direction><sound tempo="100"/></direction>' + quarter + '<sound dynamics="71"/>',
    )

    expect(warnings.map((w) => w.message)).toEqual([
      soundTempoDropped,
      'The "dynamics" of a <sound> cannot be expressed in MNX.',
    ])
  })

  // Two statements at one point, not one written twice: the mark draws 120
  // and the <sound> plays 90. Passing the second over would drop a playback
  // tempo the source states.
  test('reports one stating a tempo the mark beside it does not', () => {
    const { warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type></direction>' +
        '<sound tempo="90"/>' +
        quarter,
    )

    expect(warnings.map((w) => w.message)).toEqual([soundTempoDropped])
  })

  // MusicXML counts a <sound tempo> in quarter notes whatever the mark's
  // beat, so a dotted quarter at 72 and a tempo of 108 are one statement.
  test('passes over one counting a dotted beat in quarter notes', () => {
    const { warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<beat-unit-dot/><per-minute>72</per-minute></metronome></direction-type>' +
        '<sound tempo="108"/></direction>' +
        quarter,
    )

    expect(warnings).toEqual([])
  })

  test('reports one whose number is not a tempo at all', () => {
    const { warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type>' +
        '<sound tempo="fast"/></direction>' +
        quarter,
    )

    expect(warnings.map((w) => w.message)).toEqual([soundTempoDropped])
  })

  test('passes over an echo written with spaces around its number', () => {
    const { warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type>' +
        '<sound tempo=" 120 "/></direction>' +
        quarter,
    )

    expect(warnings).toEqual([])
  })

  // Number() reads each of these as 120, which would pass it over as an echo.
  test.each(['0x78', '1.2e2'])('reports a tempo of "%s" beside a mark of 120', (written) => {
    const { warnings } = tempos(
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>120</per-minute></metronome></direction-type>' +
        `<sound tempo="${written}"/></direction>` +
        quarter,
    )

    expect(warnings.map((w) => w.message)).toEqual([soundTempoDropped])
  })

  // A mark is the score's, drawn once, and every part carries the playback
  // echo of it.
  test('passes over one echoing a mark another part draws', () => {
    const warnings = new WarningCollector()
    const measure = (body: string) =>
      `<measure number="1"><attributes><divisions>4</divisions></attributes>${body}</measure>`
    readScore(
      parseXmlRoot(
        '<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>' +
          `<part id="P1">${measure(
            '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
              '<per-minute>63</per-minute></metronome></direction-type>' +
              '<sound tempo="63"/></direction>' +
              quarter,
          )}</part>` +
          `<part id="P2">${measure('<sound tempo="63"/>' + quarter)}</part>` +
          '</score-partwise>',
      ),
      warnings,
    )

    expect(warnings.list()).toEqual([])
  })

  // A source is free to write the playback echo before the mark it echoes.
  test('passes over one written before the <metronome> it echoes', () => {
    const { tempos: found, warnings } = tempos(
      '<direction><sound tempo="120"/></direction>' +
        '<direction><direction-type><metronome><beat-unit>half</beat-unit>' +
        '<per-minute>60</per-minute></metronome></direction-type></direction>' +
        quarter,
    )

    expect(found).toEqual([
      { position: { num: 0, den: 1 }, value: { base: 'half', dots: 0 }, bpm: 60 },
    ])
    expect(warnings).toEqual([])
  })

  // Written straight into the measure rather than inside a <direction>, which
  // reaches the reader by another path.
  test('passes over a bare one written before the <metronome> it echoes', () => {
    const { tempos: found, warnings } = tempos(
      '<sound tempo="120"/>' +
        '<direction><direction-type><metronome><beat-unit>half</beat-unit>' +
        '<per-minute>60</per-minute></metronome></direction-type></direction>' +
        quarter,
    )

    expect(found).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  // The mark is drawn a beat later, so the two are not the same statement and
  // the echo has nothing to echo.
  test('reports one whose <metronome> is at another point in the measure', () => {
    const { warnings } = tempos(
      '<sound tempo="120"/>' +
        quarter +
        '<direction><direction-type><metronome><beat-unit>half</beat-unit>' +
        '<per-minute>60</per-minute></metronome></direction-type></direction>' +
        quarter,
    )

    expect(warnings.map((w) => w.message)).toEqual([soundTempoDropped])
  })
})

// A hairpin grows or fades from here to somewhere later, often several
// measures away. MusicXML marks both ends and numbers them so they can be
// matched, as it does a slur. MNX states the pair once, on the end where it
// begins, pointing at the measure where it stops.
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
  // closes the most recently opened, as a slur does.
  test('matches each hairpin to the stop that carries its number', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo', '1') + wedge('diminuendo', '2') + NOTE,
      NOTE + wedge('stop', '2') + wedge('stop', '1'),
    )

    expect(dynamics[0]?.map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(warnings).toEqual([])
  })

  // Both hands hold a hairpin numbered 1 at once, as an exporter that numbers
  // each hand from 1 writes. Paired on the number alone, each would join the
  // other hand's stop.
  const staffWedge = (type: string, staff: string) =>
    `<direction><direction-type><wedge type="${type}" number="1"/></direction-type>` +
    `<staff>${staff}</staff></direction>`

  const bothHands = [1, 2]
    .map(
      (staff) =>
        (staff === 2 ? '<backup><duration>16</duration></backup>' : '') +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>' +
        `<type>whole</type><voice>${String(staff)}</voice><staff>${String(staff)}</staff></note>`,
    )
    .join('')

  function readTwoStaves(...bodies: string[]) {
    const warnings = new WarningCollector()
    const measures = bodies
      .map(
        (body, index) =>
          `<measure number="${String(index + 1)}">` +
          (index === 0
            ? '<attributes><divisions>4</divisions><staves>2</staves></attributes>'
            : '') +
          `${body}${bothHands}</measure>`,
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

  test('pairs a hairpin with the stop on its own staff', () => {
    const { dynamics, warnings } = readTwoStaves(
      staffWedge('crescendo', '1'),
      staffWedge('diminuendo', '2'),
      staffWedge('stop', '1'),
      staffWedge('stop', '2'),
    )

    expect(dynamics[0]?.[0]).toMatchObject({ wedge: 'increasing', staff: 1, end: { measure: 2 } })
    expect(dynamics[1]?.[0]).toMatchObject({ wedge: 'decreasing', staff: 2, end: { measure: 3 } })
    expect(warnings).toEqual([])
  })

  // A hairpin the reader dropped still takes its place in the pairing, so the
  // stop the source wrote for it is consumed with it. It has to take that
  // place on its own staff: otherwise the other hand's stop closes on it, and
  // the hairpin that hand opened ends at the wrong stop.
  test('pairs a stop with the dropped start on its own staff', () => {
    const { dynamics, warnings } = readTwoStaves(
      staffWedge('sideways', '1') + staffWedge('crescendo', '2'),
      staffWedge('stop', '1'),
      staffWedge('stop', '2'),
    )

    expect(dynamics[0]?.[0]).toMatchObject({ wedge: 'increasing', staff: 2, end: { measure: 2 } })
    expect(warnings.map((w) => w.code)).toEqual(['unsupported:element'])
  })

  // A stop closes the most recently opened hairpin of its number, and which
  // one that is cannot be known while the measure is still being read: a
  // <backup> puts the second voice's start after the first voice's stop in the
  // document, and before it in the music. So the wording written at a closing
  // edge has to wait for the pairing too, or it qualifies the wrong hairpin.
  test('carries closing wording onto the hairpin the stop really closes', () => {
    const voiced = (step: string, voice: number) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
      `<duration>4</duration><voice>${String(voice)}</voice><type>quarter</type></note>`
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo') +
        voiced('C', 1).repeat(2) +
        '<direction><direction-type>' +
        '<dynamics><other-dynamics>smorz.</other-dynamics></dynamics>' +
        '<wedge type="stop" number="1"/>' +
        '</direction-type></direction>' +
        voiced('C', 1).repeat(2) +
        '<backup><duration>16</duration></backup>' +
        voiced('E', 2) +
        wedge('diminuendo') +
        voiced('E', 2).repeat(2) +
        wedge('stop') +
        voiced('E', 2),
    )

    expect(dynamics[0]?.map((d) => ({ wedge: d.wedge, suffix: d.suffix, end: d.end }))).toEqual([
      { wedge: 'increasing', suffix: undefined, end: { measure: 0, position: { num: 3, den: 4 } } },
      { wedge: 'decreasing', suffix: 'smorz.', end: { measure: 0, position: { num: 1, den: 2 } } },
    ])
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

    expect(dynamics[0]?.[0]?.placement).toBe('below')
  })

  test('writes the side a hairpin is drawn on onto schema-valid MNX', () => {
    const { mnx } = convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions></attributes>' +
        placedWedge +
        NOTE +
        wedge('stop') +
        '</measure></part></score-partwise>',
    )

    expect(JSON.stringify(mnx)).toContain('"placement":"below"')
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

  // The source did start the hairpin, and the reader dropped it. Its stop is
  // not an orphan, so there is one warning per lost hairpin, at the dropped
  // start.
  // A stop itself is never of unknown type: its type is the word "stop", so an
  // unknown type can only open a span.
  test('warns once for a dropped wedge, not again at its stop', () => {
    const { dynamics, warnings } = readMeasures(wedge('wibble') + NOTE + wedge('stop'))

    expect(dynamics[0]).toEqual([])
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])
    expect(warnings[0]?.message).toContain('not carried over')
  })

  // A dropped start consumes its own stop, the way pairing works everywhere
  // here: a stop closes the most recently opened start of its number. The
  // healthy hairpin around it keeps its own stop.
  test('a dropped wedge consumes its own stop, leaving a healthy hairpin intact', () => {
    const body =
      wedge('crescendo') + NOTE + wedge('wibble') + NOTE + wedge('stop') + NOTE + wedge('stop')
    const { dynamics, warnings } = readMeasures(body)

    expect(dynamics[0]?.map((d) => [d.wedge, d.end])).toEqual([
      ['increasing', { measure: 0, position: { num: 3, den: 4 } }],
    ])
    expect(warnings.map((w) => w.element)).toEqual(['wedge'])

    convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
    )
  })

  // MusicXML's document order is not time order: a measure holding two voices
  // is written as one pass per voice with a <backup> between them, so a stop
  // belonging to the first voice is written before a start belonging to the
  // second. Pairing in document order would join two unrelated ends.
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

  // The shape that would make an octave shift run backwards: start and stop
  // both arrive through a forward, past the only event. A hairpin ends where
  // its stop is written, not at the last event before it, so this pair still
  // runs forwards and is kept.
  test('keeps a hairpin whose ends arrive through a forward past the only event', () => {
    const forward = (by: number) => `<forward><duration>${String(by)}</duration></forward>`
    const body = NOTE + forward(8) + wedge('crescendo') + forward(2) + wedge('stop')
    const { dynamics, warnings } = readMeasures(body)

    expect(dynamics[0]?.[0]?.position).toEqual({ num: 3, den: 4 })
    expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 7, den: 8 } })
    expect(warnings).toEqual([])

    convertValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
    )
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

  // Grace notes take none of the measure's time, so a stop written after them
  // stands where they do. MNX reads a place with no grace index as before all
  // of them, and counts back from the note they ornament: that note is 0 and
  // the rightmost grace note is 1. A hairpin drawn over grace notes must say
  // so, or they fall outside it.
  describe('ending where grace notes sit', () => {
    const GRACE =
      '<note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>'

    test('ends on the last grace note where the stop is written after them', () => {
      const { dynamics, warnings } = readMeasures(
        wedge('crescendo') + NOTE + GRACE + GRACE + wedge('stop') + NOTE,
      )

      expect(dynamics[0]?.[0]?.end).toEqual({
        measure: 0,
        position: { num: 1, den: 4 },
        graceIndex: 1,
      })
      expect(warnings).toEqual([])
    })

    // The stop stands between two grace notes, so the hairpin is drawn over
    // the first and stops before the second. Counting back from the note they
    // ornament makes the first 2.
    test('ends on the grace note the stop was written after, not the last of the group', () => {
      const { dynamics, warnings } = readMeasures(
        wedge('crescendo') + NOTE + GRACE + wedge('stop') + GRACE + NOTE,
      )

      expect(dynamics[0]?.[0]?.end).toEqual({
        measure: 0,
        position: { num: 1, den: 4 },
        graceIndex: 2,
      })
      expect(warnings).toEqual([])
    })

    // A <backup> writes the other voice after the grace notes, so the event
    // read last is not the one the stop stands on. The grace notes are still
    // where the stop is, and still written before it.
    test('counts the grace notes where another voice is written after them', () => {
      const voiced = (step: string, voice: string) =>
        `<note><voice>${voice}</voice><pitch><step>${step}</step><octave>4</octave></pitch>` +
        '<duration>4</duration><type>quarter</type></note>'
      const { dynamics, warnings } = readMeasures(
        wedge('crescendo') +
          voiced('C', '1') +
          GRACE.replace('<pitch>', '<voice>1</voice><pitch>') +
          '<backup><duration>4</duration></backup>' +
          voiced('G', '2') +
          wedge('stop'),
      )

      expect(dynamics[0]?.[0]?.end).toEqual({
        measure: 0,
        position: { num: 1, den: 4 },
        graceIndex: 1,
      })
      expect(warnings).toEqual([])
    })

    test('says nothing where the stop is written before them', () => {
      const { dynamics, warnings } = readMeasures(
        wedge('crescendo') + NOTE + wedge('stop') + GRACE + NOTE,
      )

      expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
      expect(warnings).toEqual([])
    })

    // An <offset> moves the stop away from the cursor, so the grace notes
    // standing at the cursor are no longer where the hairpin ends.
    test('says nothing where an offset moves the stop off the grace notes', () => {
      const { dynamics, warnings } = readMeasures(
        wedge('crescendo') +
          NOTE +
          GRACE +
          '<direction><direction-type><wedge type="stop" number="1"/></direction-type>' +
          '<offset>4</offset></direction>' +
          NOTE,
      )

      expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 2 } })
      expect(warnings).toEqual([])
    })

    // The stop names the other staff, so the grace notes are not under it.
    test('says nothing where the grace notes are on another staff', () => {
      const { dynamics, warnings } = readMeasures(
        '<attributes><staves>2</staves></attributes>' +
          '<direction><direction-type><wedge type="crescendo" number="1"/></direction-type>' +
          '<staff>2</staff></direction>' +
          NOTE.replace('<pitch>', '<staff>2</staff><pitch>') +
          GRACE.replace('<pitch>', '<staff>1</staff><pitch>') +
          '<direction><direction-type><wedge type="stop" number="1"/></direction-type>' +
          '<staff>2</staff></direction>',
      )

      expect(dynamics[0]?.[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
      expect(warnings).toEqual([])
    })

    test('writes the grace index onto schema-valid MNX', () => {
      const { mnx, warnings } = convertValid(
        inMeasure(wedge('crescendo') + NOTE + GRACE + wedge('stop') + NOTE),
      )

      expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]?.end).toEqual({
        measure: 'm1',
        position: { fraction: [1, 4], graceIndex: 1 },
      })
      expect(warnings).toEqual([])
    })
  })
})
