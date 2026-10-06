// A <direction> sits between the notes, at wherever the cursor has reached. A
// dynamic goes on the part's measure at that position; a metronome mark goes
// on the score's measure, since tempo is the whole score's. What MNX cannot
// state, like a word or a pedal, is reported.

import { readValid } from '../../tests/support/read.js'
import { describe, expect, test } from 'vitest'
import { convertValid } from '../../tests/support/convert.js'
import { WarningCollector } from './collector.js'
import type { Dynamic, GradualDynamic } from '../model/score.js'

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
  const score = readValid(source, warnings)
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

    expect(measure?.dynamics).toEqual([
      { kind: 'immediate', position: { num: 0, den: 1 }, value: 'f' },
    ])
  })
})

describe('dynamics', () => {
  const lone = (text: string) => ({
    code: 'unrepresentable:dynamic-wording',
    element: 'other-dynamics',
    message:
      `The dynamic wording "${text}" qualifies no mark, and MNX states wording only on a ` +
      'mark, so it is not converted.',
  })
  test('places a dynamic on the measure at the cursor', () => {
    const { measure } = read(inMeasure(direction('<dynamics><f/></dynamics>') + note('C')))

    expect(measure?.dynamics).toEqual([
      { kind: 'immediate', position: { num: 0, den: 1 }, value: 'f' },
    ])
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

  // MNX states no side for a segno or a tempo, which are drawn above the
  // staff. One placed below is drawn on a side the output cannot state.
  test.each([
    ['segno', '<segno/>'],
    ['tempo', '<metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome>'],
  ])('reports a %s placed below the staff', (_, mark) => {
    const { warnings } = read(
      inMeasure(
        `<direction placement="below"><direction-type>${mark}</direction-type></direction>` +
          note('C'),
      ),
    )

    expect(warnings).toEqual([
      {
        code: 'unrepresentable:attribute',
        message:
          'This <direction> places a segno or a tempo below the staff, and MNX states no ' +
          'side for either. The segno or tempo is converted without its placement.',
        element: 'direction',
        attribute: 'placement',
        context: { part: 'P1', measure: 1, line: 1 },
      },
    ])
  })

  test.each([
    ['segno', '<segno/>'],
    ['tempo', '<metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome>'],
  ])('says nothing of a %s placed above the staff', (_, mark) => {
    const { warnings } = read(
      inMeasure(
        `<direction placement="above"><direction-type>${mark}</direction-type></direction>` +
          note('C'),
      ),
    )

    expect(warnings).toEqual([])
  })

  const tempo = '<metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome>'
  test.each([
    ['segno', 'a dynamic', '<segno/>', '<dynamics><p/></dynamics>'],
    ['segno', 'a hairpin', '<segno/>', '<wedge type="crescendo"/>'],
    ['segno', 'an octave shift', '<segno/>', '<octave-shift type="down" size="8"/>'],
    ['tempo', 'a dynamic', tempo, '<dynamics><p/></dynamics>'],
  ])('reports a %s placed below beside %s', (_, __, first, mark) => {
    const { warnings } = read(
      inMeasure(
        `<direction placement="below"><direction-type>${first}${mark}</direction-type>` +
          '</direction>' +
          note('C'),
      ),
    )

    expect(warnings.filter((w) => w.attribute === 'placement')).toEqual([
      {
        code: 'unrepresentable:attribute',
        message:
          'This <direction> places a segno or a tempo below the staff, and MNX states no ' +
          'side for either. The segno or tempo is converted without its placement.',
        element: 'direction',
        attribute: 'placement',
        context: { part: 'P1', measure: 1, line: 1 },
      },
    ])
  })

  test('says nothing of a dynamic placed below on its own', () => {
    const { measure, warnings } = read(
      inMeasure(
        '<direction placement="below"><direction-type><dynamics><p/></dynamics>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.placement).toBe('below')
    expect(warnings).toEqual([])
  })

  // The warning about the mark covers the side it is drawn on.
  test('reports only the mark where the direction converts nothing', () => {
    const { warnings } = read(
      inMeasure(
        '<direction placement="below"><direction-type><rehearsal>A</rehearsal>' +
          '</direction-type></direction>' +
          note('C'),
      ),
    )

    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['rehearsal', undefined]])
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

    expect(measure?.dynamics[0]).toMatchObject({ kind: 'immediate', value })
    expect(warnings).toEqual([])
  })

  test('writes an extreme dynamic the spec schema accepts', () => {
    const { mnx } = convertValid(inMeasure(direction('<dynamics><pppp/></dynamics>') + note('C')))

    expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toMatchObject({ value: 'pppp' })
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

    expect(measure?.dynamics[0]).toEqual({
      kind: 'accent',
      position: { num: 0, den: 1 },
      value,
      residualValue: undefined,
      accentPrefix: prefix,
      accentSuffix: suffix,
      glyphs: [glyph],
      staff: undefined,
    })
    expect(warnings).toEqual([])
  })

  // pf (poco forte / piano-forte) has no single settled reading of its two
  // letters, and MNX requires an accent to state the level of its attack.
  test('reports pf, and leaves it out', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><pf/></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings).toMatchObject([
      {
        code: 'unsupported:element',
        element: 'pf',
        message: 'A dynamic of "pf" is not converted yet.',
      },
    ])
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

      expect(measure?.dynamics[0]).toMatchObject({
        kind: 'accent',
        value: attack,
        residualValue: residual,
        accentPrefix: prefix,
        accentSuffix: suffix,
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
    expect(measure?.dynamics[0]).toMatchObject({ value: 'f' })
    expect(warnings).toEqual([])
  })

  test('reads text after a mark as its suffix', () => {
    const { measure, warnings } = read(
      inMeasure(
        direction('<dynamics><p/><other-dynamics> dolce</other-dynamics></dynamics>') + note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.suffix).toBe('dolce')
    expect(measure?.dynamics[0]).toMatchObject({ value: 'p' })
    expect(warnings).toEqual([])
  })

  test('reads text qualifying an accent as its prefix', () => {
    const { measure } = read(
      inMeasure(
        direction('<dynamics><other-dynamics>poco </other-dynamics><sf/></dynamics>') + note('C'),
      ),
    )

    expect(measure?.dynamics[0]?.prefix).toBe('poco')
    expect(measure?.dynamics[0]).toMatchObject({ glyphs: ['dynamicSforzando1'] })
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

  // MNX requires an immediate dynamic to state a level, and states wording
  // only beside one.
  test('reports wording standing alone, and leaves it out', () => {
    const { measure, warnings } = read(
      inMeasure(direction('<dynamics><other-dynamics>sff</other-dynamics></dynamics>') + note('C')),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings).toMatchObject([lone('sff')])
  })

  test('writes a measure whose only dynamic is wording onto schema-valid MNX', () => {
    const { mnx, warnings } = convertValid(
      inMeasure(
        direction('<dynamics><other-dynamics>dolce</other-dynamics></dynamics>') + note('C'),
      ),
    )

    expect(mnx.parts[0]?.measures[0]?.dynamics).toBeUndefined()
    expect(warnings).toMatchObject([lone('dolce')])
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

    expect(measure?.dynamics[0]).toMatchObject({
      end: { measure: 0, position: { num: 1, den: 4 } },
    })
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
        kind: 'gradual',
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

    expect(measure?.dynamics[0]).toMatchObject({ wedge: 'increasing' })
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
        kind: 'gradual',
        position: { num: 0, den: 1 },
        wedge: 'decreasing',
        suffix: 'smorz.',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toEqual([])
  })

  // The wording waits on the stop until the part is whole, and is reported
  // once the pairing finds the stop closed nothing.
  test('reports wording at a stop that closes nothing, after a <backup>', () => {
    const { measure, warnings } = read(
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

    expect(measure?.dynamics).toMatchObject([{ position: { num: 1, den: 4 }, value: 'f' }])
    expect(warnings.map((w) => w.code)).toEqual([
      'unclosed:spanner',
      'unrepresentable:dynamic-wording',
    ])
    expect(warnings[1]).toMatchObject(lone('morendo'))
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
        kind: 'gradual',
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
  // qualifies no mark. Both are reported.
  test('reports wording beside a stray stop', () => {
    const { measure, warnings } = read(
      inMeasure(
        note('C') +
          '<direction><direction-type>' +
          '<dynamics><other-dynamics>dim.</other-dynamics></dynamics>' +
          '<wedge type="stop"/>' +
          '</direction-type></direction>',
      ),
    )

    expect(measure?.dynamics).toEqual([])
    expect(warnings).toMatchObject([
      { message: 'A hairpin stops where none had started, and is not carried over.' },
      lone('dim.'),
    ])
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
      { kind: 'immediate', position: { num: 1, den: 4 }, value: 'p' },
    ])
    expect(warnings).toMatchObject([
      { message: 'A hairpin stops where none had started, and is not carried over.' },
      lone('dim.'),
    ])
  })

  // A source can word both edges of one hairpin. The suffix set where it
  // started stays, and the closing words are reported rather than overwrite it.
  test('reports closing wording when the hairpin already has a suffix', () => {
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
        kind: 'gradual',
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'molto',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toMatchObject([lone('cresc.')])
  })

  test('reports wording after the stop when the hairpin already has a suffix', () => {
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
        kind: 'gradual',
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'molto',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toMatchObject([lone('sempre')])
  })

  // A source can word both sides of one closing edge. The hairpin takes the
  // first, since one mark carries one suffix, and the second is reported.
  test('reports the second wording at one closing edge', () => {
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
        kind: 'gradual',
        position: { num: 0, den: 1 },
        wedge: 'increasing',
        suffix: 'dim.',
        end: { measure: 0, position: { num: 1, den: 4 } },
      },
    ])
    expect(warnings).toMatchObject([lone('poco')])
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

    expect(measure?.dynamics).toEqual([
      { kind: 'immediate', position: { num: 0, den: 1 }, value: 'f', prefix: 'più' },
    ])
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

    expect(measure?.dynamics[0]).toMatchObject({ value: 'p' })
    expect(measure?.dynamics[0]?.prefix).toBeUndefined()
    expect(warnings.map((w) => w.message)).toEqual([
      'A dynamic of "fffffff" is not converted yet.',
      'A dynamic wording of "più" is not converted yet, because the "fffffff" it qualifies is not.',
    ])
  })

  // An element naming a glyph and holding no text is a mark drawn as that
  // glyph alone, which is notation, not an empty element to pass over. It is
  // a converter gap, not a format limit: a later release may read the level
  // the glyph draws.
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
    expect(measure?.dynamics[0]).toMatchObject({ glyphs: ['dynamicSforzato'] })
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
    expect(warnings.map((w) => w.code)).toEqual(['unresolved:element-value'])
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

  // The mark is dropped whole, so each reason is reported at the <metronome>,
  // whichever child gives it.
  test.each([
    ['an empty per-minute', '<beat-unit>quarter</beat-unit>\n<per-minute></per-minute>'],
    ['a per-minute of zero', '<beat-unit>quarter</beat-unit>\n<per-minute>0</per-minute>'],
    ['a beat unit that is no note value', '\n<beat-unit></beat-unit><per-minute>60</per-minute>'],
  ])('reports a metronome with %s at the metronome', (_what, body) => {
    const { warnings } = read(inMeasure(direction(`<metronome>${body}</metronome>`) + note('C')))

    expect(warnings.map((w) => [w.element, w.context.line])).toEqual([['metronome', 1]])
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

  // MNX states no form for an alpha channel, so a translucent color is
  // converted opaque and the alpha is reported.
  test('reports an alpha channel and converts the color opaque', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno color="#80FF0000"/>') + note('C')),
    )

    expect(global?.segno?.color).toBe('#FF0000')
    expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
      ['unrepresentable:color', 'segno', 'color'],
    ])
  })

  test.each(['red', 'x#FF0000', 'x#FFFF0000', '#FFFF00000'])(
    'reports a color of "%s", which is not a MusicXML color, converting none',
    (written) => {
      const { global, warnings } = read(
        inMeasure(direction(`<segno color="${written}"/>`) + note('C')),
      )

      expect(global?.segno?.color).toBeUndefined()
      expect(warnings.map((w) => [w.code, w.element, w.attribute])).toEqual([
        ['unresolved:attribute-value', 'segno', 'color'],
      ])
    },
  )

  // MNX draws one segno per measure, so a second at another point is reported
  // and the first kept.
  test('reports a second segno at a different point in the measure', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno/>') + note('C') + '\n' + direction('<segno/>') + note('D')),
    )

    expect(global?.segno).toEqual({ location: { num: 0, den: 1 }, glyph: undefined })
    expect(warnings.map((w) => w.element)).toEqual(['segno'])
    expect(warnings[0]?.context.line).toBe(2)
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

  test.each(['8x', 'x8', '-8'])('reports a <sound fine> written as "%s"', (written) => {
    const { global, warnings } = read(inMeasure(note('C') + `<sound fine="${written}"/>`))

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
    const { global, warnings } = read(
      inMeasure(direction('<segno/>') + note('C') + '<sound dalsegno="segno"/>'),
    )

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
      inMeasure('<sound fine="yes"/>' + note('C') + '\n<sound fine="yes"/>'),
    )

    expect(global?.fine).toEqual({ location: { num: 0, den: 1 } })
    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['sound', 'fine']])
    expect(warnings[0]?.context.line).toBe(2)
    expect(warnings[0]?.message).toContain('more than one fine')
  })

  test('reports a second jump at a different point in the measure', () => {
    const { global, warnings } = read(
      inMeasure(
        '<sound dalsegno="segno"/>' +
          note('C') +
          '\n<direction><direction-type><segno/></direction-type>' +
          '<sound dalsegno="segno"/></direction>',
      ),
    )

    expect(global?.jump).toEqual({ location: { num: 0, den: 1 }, type: 'segno' })
    expect(warnings.map((w) => [w.element, w.attribute])).toEqual([['sound', 'dalsegno']])
    expect(warnings[0]?.context.line).toBe(2)
    expect(warnings[0]?.message).toContain('more than one jump')
  })

  // A jump carries other playback the output cannot hold; the jump converts
  // and the rest is still reported.
  test('reports the playback a <sound dalsegno> carries besides the jump', () => {
    const { global, warnings } = read(
      inMeasure(direction('<segno/>') + note('C') + '<sound dalsegno="segno" dynamics="54"/>'),
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
    const { global, warnings } = read(
      inMeasure(direction('<segno/>') + note('C') + '<sound fine="yes" dalsegno="segno"/>'),
    )

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
    const score = readValid(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
        direction('<segno/>') +
        note('C') +
        '<sound dalsegno="segno"/></measure>' +
        '<measure number="2">' +
        note('C') +
        '<sound fine="yes"/></measure>' +
        '</part></score-partwise>',
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
    const score = readValid(
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
    const score = readValid(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
        '<direction><direction-type><segno/></direction-type></direction>' +
        note('C') +
        '</measure>' +
        `<measure number="2">${note('C')}<sound fine="yes"/></measure>` +
        `<measure number="3">${note('C')}<sound dalsegno="whatever"/></measure>` +
        '</part></score-partwise>',
      warnings,
    )

    expect(score.globalMeasures[2]?.jump?.type).toBe('dsalfine')
  })

  // With no sign to go back to, a player takes the jump from the start, so a
  // Fine anywhere stops it. The source still names a sign it never draws.
  test('reports a jump in a score that draws no segno', () => {
    const { global, warnings } = read(
      inMeasure(note('C') + '\n<sound fine="yes" dalsegno="segno"/>'),
    )

    expect(global?.jump?.type).toBe('dsalfine')
    expect(warnings).toEqual([
      {
        code: 'unresolved:segno',
        message:
          'This dal segno jump returns to a segno, but the score draws none. The jump ' +
          'is converted with no segno to return to, and is ended by a Fine anywhere in ' +
          'the score.',
        element: 'sound',
        attribute: 'dalsegno',
        context: { measure: 1, line: 2 },
      },
    ])
  })

  // With several signs, only the name says which one the jump returns to. A
  // name matching none of them leaves open whether a Fine stops the jump.
  test('reports a jump naming none of the segnos the score draws', () => {
    const warnings = new WarningCollector()
    const score = readValid(
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
        `<measure number="4">${note('C')}\n<sound dalsegno="third"/></measure>` +
        '</part></score-partwise>',
      warnings,
    )

    expect(score.globalMeasures[3]?.jump?.type).toBe('segno')
    expect(warnings.list().filter((w) => w.code === 'unresolved:segno')).toEqual([
      {
        code: 'unresolved:segno',
        message:
          'This dal segno jump returns to the segno "third", which is none of the ' +
          'segnos the score draws. The jump is converted as a plain dal segno, not a ' +
          'D.S. al Fine.',
        element: 'sound',
        attribute: 'dalsegno',
        context: { measure: 4, line: 2 },
      },
    ])
  })

  test('reports a jump naming no segno where the score draws several', () => {
    const warnings = new WarningCollector()
    readValid(
      '<score-partwise><part id="P1">' +
        '<measure number="1"><attributes><divisions>4</divisions></attributes>' +
        '<direction><direction-type><segno/></direction-type>' +
        '<sound segno="first"/></direction>' +
        note('C') +
        '</measure>' +
        '<measure number="2">' +
        '<direction><direction-type><segno/></direction-type>' +
        '<sound segno="second"/></direction>' +
        note('C') +
        '</measure>' +
        '<measure number="3">' +
        note('C') +
        '<direction><direction-type><words>D.S.</words></direction-type>' +
        '<sound dalsegno=""/></direction>' +
        '</measure>' +
        '</part></score-partwise>',
      warnings,
    )

    expect(
      warnings
        .list()
        .filter((w) => w.code === 'unresolved:segno')
        .map((w) => w.message),
    ).toEqual([
      'This dal segno jump names no segno, and the score draws several. The jump is ' +
        'converted as a plain dal segno, not a D.S. al Fine.',
    ])
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
    const score = readValid(
      `<score-partwise><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`,
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
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
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
    readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `${dynamic('<offset>2</offset>')}</measure></part></score-partwise>`,
      warnings,
    )

    expect(warnings.list().map((w) => w.code)).toContain('missing:divisions')
  })

  // MusicXML types an offset as a decimal.
  test.each([
    ['2.0', { num: 3, den: 8 }],
    ['2.5', { num: 13, den: 32 }],
    ['-.5', { num: 7, den: 32 }],
  ])('moves the mark by an offset of %s exactly', (written, position) => {
    const { positions, warnings } = at(quarter + dynamic(`<offset>${written}</offset>`))

    expect(positions).toEqual([position])
    expect(warnings).toEqual([])
  })

  test('counts an offset in a decimal <divisions>', () => {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>2.5</divisions></attributes>' +
        '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2.5</duration>' +
        `<type>quarter</type></note>${dynamic('<offset>1.25</offset>')}` +
        '</measure></part></score-partwise>',
      warnings,
    )

    expect(score.parts[0]?.measures[0]?.dynamics.map((d) => d.position)).toEqual([
      { num: 3, den: 8 },
    ])
    expect(warnings.list()).toEqual([])
  })

  // "1e1" is not how MusicXML writes a decimal, which is the source's problem.
  // Twenty digits pass the number's pattern but cannot be read back exactly,
  // which is this converter's.
  test.each([
    ['1e1', 'unresolved:element-value', 'is not a number of divisions'],
    ['99999999999999999999', 'unsupported:element', 'cannot be read exactly'],
  ])('leaves the mark where it was where the offset is "%s"', (written, code, reason) => {
    const { positions, warnings } = at(quarter + dynamic(`<offset>${written}</offset>`))

    expect(positions).toEqual([{ num: 1, den: 4 }])
    expect(warnings.map((w) => [w.element, w.code])).toEqual([['offset', code]])
    expect(warnings[0]?.message).toContain(reason)
  })

  // The other end of the bar is only knowable once a time signature is in
  // force. Without one, an offset running forward is applied whatever it
  // says, because there is nothing to say it has left the measure.
  function inTime(body: string) {
    const warnings = new WarningCollector()
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        '<attributes><divisions>4</divisions>' +
        '<time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
        `${body}</measure></part></score-partwise>`,
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
    const score = readValid(
      '<score-partwise><part id="P1"><measure number="1">' +
        `<attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`,
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
    readValid(
      '<score-partwise><part-list><score-part id="P1"/><score-part id="P2"/></part-list>' +
        `<part id="P1">${measure(
          '<direction><direction-type><metronome><beat-unit>quarter</beat-unit>' +
            '<per-minute>63</per-minute></metronome></direction-type>' +
            '<sound tempo="63"/></direction>' +
            quarter,
        )}</part>` +
        `<part id="P2">${measure('<sound tempo="63"/>' + quarter)}</part>` +
        '</score-partwise>',
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
  /** The hairpins of a measure, failing on any other mark. */
  const hairpins = (marks: readonly Dynamic[] | undefined): GradualDynamic[] =>
    (marks ?? []).map((mark) => {
      if (mark.kind !== 'gradual') throw new Error(`Expected a hairpin, found ${mark.kind}.`)
      return mark
    })

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
    const score = readValid(
      `<score-partwise><part id="P1">${measures}</part></score-partwise>`,
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
      kind: 'gradual',
      position: { num: 0, den: 1 },
      wedge: 'increasing',
      end: { measure: 1, position: { num: 1, den: 4 } },
      staff: undefined,
    })
    expect(dynamics[1]).toEqual([])
    expect(warnings).toEqual([])
  })

  test('states a diminuendo as a wedge closing', () => {
    const { dynamics } = readMeasures(wedge('diminuendo') + NOTE + wedge('stop'))

    expect(hairpins(dynamics[0])[0]?.wedge).toBe('decreasing')
    expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
  })

  // Several may be open at once, so each number holds a stack and a stop
  // closes the most recently opened, as a slur does.
  test('matches each hairpin to the stop that carries its number', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo', '1') + wedge('diminuendo', '2') + NOTE,
      NOTE + wedge('stop', '2') + wedge('stop', '1'),
    )

    expect(hairpins(dynamics[0]).map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
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
    const score = readValid(
      `<score-partwise><part id="P1">${measures}</part></score-partwise>`,
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
    expect(dynamics.flat().map((d) => d.kind === 'gradual' && d.staffEnd)).toEqual([
      undefined,
      undefined,
    ])
    expect(warnings).toEqual([])
  })

  // MNX draws such a hairpin diagonally, from the staff it starts on to the
  // one it stops on.
  test('ends a hairpin on the staff its stop names', () => {
    const { dynamics, warnings } = readTwoStaves(
      staffWedge('crescendo', '1'),
      staffWedge('stop', '2'),
    )

    expect(dynamics[0]?.[0]).toMatchObject({ staff: 1, staffEnd: 2, end: { measure: 1 } })
    expect(warnings).toEqual([])
  })

  // An exporter writes a hairpin that starts and stops at one point with its
  // stop first. Left as an orphan, the stop frees the start to take a later
  // stop of its number, here the other hand's, two measures on.
  test('pairs a stop written at the barline with a start of its number just after', () => {
    const atBarline = (wedge: string) =>
      `<forward><duration>16</duration></forward>${wedge}<backup><duration>16</duration></backup>`
    const atHalf = (wedge: string) =>
      `<forward><duration>8</duration></forward>${wedge}<backup><duration>8</duration></backup>`
    const { dynamics, warnings } = readTwoStaves(
      atBarline(staffWedge('stop', '1')),
      staffWedge('crescendo', '1') + atHalf(staffWedge('crescendo', '1')),
      staffWedge('stop', '1'),
      staffWedge('stop', '2'),
    )

    expect(dynamics.flat()).toEqual([
      expect.objectContaining({
        position: { num: 1, den: 2 },
        staff: 1,
        end: { measure: 2, position: { num: 0, den: 1 } },
      }),
    ])
    expect(dynamics[1]?.[0]).not.toHaveProperty('staffEnd')
    expect(warnings.map((w) => [w.code, w.context.measure, w.message])).toEqual([
      [
        'unclosed:spanner',
        2,
        'A hairpin stops at the point where it starts, and is not carried over.',
      ],
      ['unclosed:spanner', 4, 'A hairpin stops where none had started, and is not carried over.'],
    ])
  })

  // The stop has no hairpin open on its own staff, so it could close the
  // other hand's. The start written beside it is the one it belongs to.
  test('pairs a stop with a start beside it before reaching to another staff', () => {
    const at = (divisions: number, wedge: string) =>
      `<forward><duration>${String(divisions)}</duration></forward>${wedge}` +
      `<backup><duration>${String(divisions)}</duration></backup>`
    const { dynamics, warnings } = readTwoStaves(
      staffWedge('crescendo', '1') +
        at(8, staffWedge('stop', '2') + staffWedge('crescendo', '2')) +
        at(12, staffWedge('stop', '1')),
    )

    expect(dynamics.flat()).toEqual([
      expect.objectContaining({ staff: 1, end: { measure: 0, position: { num: 3, den: 4 } } }),
    ])
    expect(dynamics[0]?.[0]).not.toHaveProperty('staffEnd')
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops at the point where it starts, and is not carried over.',
    ])
  })

  test('pairs a stop with a start of its number at the same point in one measure', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo') + NOTE + NOTE + wedge('stop') + wedge('stop') + wedge('diminuendo') + NOTE,
      wedge('crescendo') + NOTE + wedge('stop'),
      NOTE + wedge('stop'),
    )

    expect(hairpins(dynamics[0]).map((d) => [d.wedge, d.end])).toEqual([
      ['increasing', { measure: 0, position: { num: 1, den: 2 } }],
    ])
    expect(hairpins(dynamics[1]).map((d) => [d.wedge, d.end])).toEqual([
      ['increasing', { measure: 1, position: { num: 1, den: 4 } }],
    ])
    expect(warnings.map((w) => [w.context.measure, w.message])).toEqual([
      [1, 'A hairpin stops at the point where it starts, and is not carried over.'],
      [3, 'A hairpin stops where none had started, and is not carried over.'],
    ])
  })

  // Each is a stop and a start at two different instants, or of two numbers,
  // so the start is a hairpin of its own and the stop closes nothing.
  test.each([
    ['of another number', [NOTE + wedge('stop', '2') + wedge('crescendo') + NOTE + wedge('stop')]],
    [
      'later in the measure',
      [NOTE + wedge('stop') + NOTE + wedge('crescendo') + NOTE + wedge('stop')],
    ],
    [
      'after a stop short of the barline',
      [NOTE + wedge('stop') + NOTE, wedge('crescendo') + NOTE + wedge('stop')],
    ],
    [
      'past the first beat after the barline',
      [NOTE + wedge('stop'), NOTE + wedge('crescendo') + NOTE + wedge('stop')],
    ],
    [
      'a measure after the next',
      [NOTE + wedge('stop'), NOTE, wedge('crescendo') + NOTE + wedge('stop')],
    ],
  ])('keeps a start %s apart from a stop that closes nothing', (_where, bodies) => {
    const { dynamics, warnings } = readMeasures(...bodies)

    expect(dynamics.flat()).toEqual([expect.objectContaining({ wedge: 'increasing' })])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops where none had started, and is not carried over.',
    ])
  })

  test('names the wording that goes with a hairpin of no length', () => {
    const { dynamics, warnings } = readMeasures(
      NOTE +
        wedge('stop') +
        '<direction><direction-type>' +
        '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
        '<wedge type="crescendo" number="1"/>' +
        '</direction-type></direction>' +
        NOTE,
    )

    expect(dynamics.flat()).toEqual([])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops at the point where it starts, and is not carried over, ' +
        'nor its wording "cresc.".',
    ])
  })

  // Stopping one hairpin and starting the next at one point is the usual way
  // to write a crescendo turning into a diminuendo.
  test('opens a hairpin where a stop closes the one before it', () => {
    const { dynamics, warnings } = readMeasures(
      wedge('crescendo') + NOTE + wedge('stop') + wedge('diminuendo') + NOTE + wedge('stop'),
    )

    expect(hairpins(dynamics[0]).map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(warnings).toEqual([])
  })

  // A hairpin naming no staff can be the one a stop on staff 1 closes, so the
  // stop closes it rather than taking the start written beside it.
  test.each([
    ['the start', '', '1'],
    ['the stop and the next start', '1', ''],
  ])(
    'closes a hairpin where %s names no staff, before the start beside the stop',
    (_what, first, then) => {
      const named = (type: string, staff: string) =>
        staff === '' ? wedge(type) : staffWedge(type, staff)
      const { dynamics, warnings } = readTwoStaves(
        named('crescendo', first),
        named('stop', then) + named('diminuendo', then),
        named('stop', then),
      )

      expect(dynamics.flat().map((d) => d.kind === 'gradual' && [d.wedge, d.end?.measure])).toEqual(
        [
          ['increasing', 1],
          ['decreasing', 2],
        ],
      )
      expect(warnings).toEqual([])
    },
  )

  // In a measure the notes leave short of its time signature, the barline is
  // where the signature puts it, past the last note.
  test('takes the barline from the time signature where the notes stop short of it', () => {
    const { dynamics, warnings } = readMeasures(
      '<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>' +
        NOTE +
        wedge('stop'),
      wedge('crescendo') + NOTE + wedge('stop'),
    )

    expect(dynamics.flat()).toEqual([expect.objectContaining({ wedge: 'increasing' })])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops where none had started, and is not carried over.',
    ])
  })

  // The other hand's stop is no stop of this hairpin.
  test('leaves a stop on another staff an orphan where a hairpin starts', () => {
    const { dynamics, warnings } = readTwoStaves(
      staffWedge('stop', '2') + staffWedge('crescendo', '1'),
      staffWedge('stop', '1'),
    )

    expect(dynamics[0]?.[0]).toMatchObject({ staff: 1, end: { measure: 1 } })
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin stops where none had started, and is not carried over.',
    ])
  })

  // A hairpin naming no staff applies to every staff of the part.
  test('ends a hairpin naming no staff on none', () => {
    const { dynamics, warnings } = readTwoStaves(
      '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>',
      staffWedge('stop', '2'),
    )

    expect(dynamics[0]?.[0]).toMatchObject({ staff: undefined, end: { measure: 1 } })
    expect(dynamics[0]?.[0]).not.toHaveProperty('staffEnd')
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
    expect(warnings.map((w) => w.code)).toEqual(['unresolved:attribute-value'])
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

    expect(
      hairpins(dynamics[0]).map((d) => ({ wedge: d.wedge, suffix: d.suffix, end: d.end })),
    ).toEqual([
      { wedge: 'increasing', suffix: undefined, end: { measure: 0, position: { num: 3, den: 4 } } },
      { wedge: 'decreasing', suffix: 'smorz.', end: { measure: 0, position: { num: 1, den: 2 } } },
    ])
    expect(warnings).toEqual([])
  })

  // MNX requires a gradual dynamic to state where it ends.
  test('drops a hairpin nothing closes, and reports it', () => {
    const { dynamics, warnings } = readMeasures(wedge('crescendo') + NOTE)

    expect(dynamics[0]).toEqual([])
    expect(warnings.map((w) => [w.code, w.element])).toEqual([['unclosed:spanner', 'wedge']])
    expect(warnings[0]?.message).toBe(
      'A hairpin starts where nothing ends it, and is not carried over.',
    )
  })

  test('names the wording that goes with a hairpin nothing closes', () => {
    const { dynamics, warnings } = readMeasures(
      '<direction><direction-type>' +
        '<dynamics><other-dynamics>cresc.</other-dynamics></dynamics>' +
        '<wedge type="crescendo" number="1"/>' +
        '<dynamics><other-dynamics>poco a poco</other-dynamics></dynamics>' +
        '</direction-type></direction>' +
        NOTE,
    )

    expect(dynamics[0]).toEqual([])
    expect(warnings.map((w) => w.message)).toEqual([
      'A hairpin starts where nothing ends it, and is not carried over, nor its wording ' +
        '"cresc." and "poco a poco".',
    ])
  })

  test('drops only the hairpin nothing closes, and keeps the marks around it', () => {
    const { dynamics } = readMeasures(
      wedge('crescendo') +
        NOTE +
        wedge('stop') +
        '<direction><direction-type><dynamics><f/></dynamics></direction-type></direction>' +
        wedge('diminuendo') +
        NOTE,
    )

    expect(dynamics[0]).toHaveLength(2)
    expect(dynamics[0]).toMatchObject([{ wedge: 'increasing' }, { value: 'f' }])
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

  // MusicXML's wedge is a crescendo, a diminuendo, a stop or a continue.
  test('reports a wedge of a type MusicXML does not define', () => {
    const { warnings } = readMeasures(wedge('wibble') + NOTE)

    expect(warnings.map((w) => [w.element, w.code, w.attribute, w.message])).toEqual([
      [
        'wedge',
        'unresolved:attribute-value',
        'type',
        'A <wedge> of type "wibble" is not one MusicXML defines, ' +
          'so the whole hairpin is not carried over.',
      ],
    ])
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

    expect(hairpins(dynamics[0]).map((d) => [d.wedge, d.end])).toEqual([
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

    expect(hairpins(dynamics[0]).map((d) => [d.wedge, d.position, d.end])).toEqual([
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
    expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 7, den: 8 } })
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

    expect(hairpins(dynamics[0]).map((d) => d.wedge)).toEqual(['increasing', 'decreasing'])
    expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
    expect(hairpins(dynamics[0])[1]?.end).toEqual({ measure: 0, position: { num: 1, den: 2 } })
    expect(warnings).toEqual([])
  })

  test('reports a wedge that states no type at all', () => {
    const { warnings } = readMeasures(
      '<direction><direction-type><wedge number="1"/></direction-type></direction>' + NOTE,
    )

    expect(warnings.map((w) => [w.element, w.code, w.message])).toEqual([
      [
        'wedge',
        'missing:attribute',
        'A <wedge> states no type, so the whole hairpin is not carried over.',
      ],
    ])
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 2 } })
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

      expect(hairpins(dynamics[0])[0]?.end).toEqual({ measure: 0, position: { num: 1, den: 4 } })
      expect(warnings).toEqual([])
    })

    test('writes the grace index onto schema-valid MNX', () => {
      const { mnx, warnings } = convertValid(
        inMeasure(wedge('crescendo') + NOTE + GRACE + wedge('stop') + NOTE),
      )

      expect(mnx.parts[0]?.measures[0]?.dynamics?.[0]).toMatchObject({
        end: { measure: 'm1', position: { fraction: [1, 4], graceIndex: 1 } },
      })
      expect(warnings).toEqual([])
    })
  })
})
