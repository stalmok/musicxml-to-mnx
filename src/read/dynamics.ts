// Reading a <dynamics>: the marks MNX states as a dynamic, and the wording
// around them.

import type { Fraction } from '../fraction.js'
import type {
  AccentPrefix,
  AccentSuffix,
  Dynamic,
  DynamicValue,
  RelativeDynamicValue,
} from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { XmlElement } from '../xml/parse.js'
import { attribute, peekAttribute, text, trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { recogniser } from './tables.js'
import type { PendingWording } from './wording.js'

// The plain dynamic marks MNX states as a value.
const isDynamicValue = recogniser<DynamicValue>({
  pppppp: true,
  ppppp: true,
  pppp: true,
  ppp: true,
  pp: true,
  p: true,
  mp: true,
  mf: true,
  f: true,
  ff: true,
  fff: true,
  ffff: true,
  fffff: true,
  ffffff: true,
  n: true,
})

// The accent dynamics, such as a sforzando, spelled out the way MNX states
// them: the value is the level of the attack, the letters around it are the
// accent's prefix and suffix, and a two-stage accent (fp is a forte attack
// held at piano) adds the level it settles to as the residual.
//
// pf (poco forte / piano-forte) is left out: its two letters have no settled
// reading, and MNX requires an accent to state the level of its attack.
interface AccentSpelling {
  value: DynamicValue
  residualValue: DynamicValue | undefined
  prefix: AccentPrefix
  suffix: AccentSuffix
}

const ATTACK_LEVELS = [
  'f',
  'ff',
  'fff',
  'ffff',
  'fffff',
  'ffffff',
] as const satisfies readonly DynamicValue[]
const RESIDUAL_LEVELS = [
  'pppppp',
  'ppppp',
  'pppp',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
] as const satisfies readonly DynamicValue[]

// Every accent spelled as its letters: an "s" or "r", the attack, a "z", then
// the residual level. Each part but the attack may be left out, though not
// all of them at once, which leaves a plain mark.
const ACCENT_SPELLINGS = new Map<string, AccentSpelling>()
for (const prefix of ['', 's', 'r'] as const) {
  for (const value of ATTACK_LEVELS) {
    for (const suffix of ['', 'z'] as const) {
      for (const residualValue of [undefined, ...RESIDUAL_LEVELS]) {
        if (prefix === '' && suffix === '' && residualValue === undefined) continue
        ACCENT_SPELLINGS.set(`${prefix}${value}${suffix}${residualValue ?? ''}`, {
          value,
          residualValue,
          prefix,
          suffix,
        })
      }
    }
  }
}

// The MusicXML elements for an accent, with the precomposed glyph from
// SMuFL's dynamics range each is drawn as, carried so the mark is drawn as
// written.
const ACCENT_GLYPHS = new Map([
  ['sf', 'dynamicSforzando1'],
  ['sfz', 'dynamicSforzato'],
  ['fz', 'dynamicForzando'],
  ['rf', 'dynamicRinforzando1'],
  ['rfz', 'dynamicRinforzando2'],
  ['sffz', 'dynamicSforzatoFF'],
  ['fp', 'dynamicFortePiano'],
  ['sfp', 'dynamicSforzandoPiano'],
  ['sfpp', 'dynamicSforzandoPianissimo'],
  ['sfzp', 'dynamicSforzatoPiano'],
])

// The letters each glyph in SMuFL's dynamics range draws, for a mark a source
// writes as the glyph alone.
export const GLYPH_LETTERS: ReadonlyMap<string, string> = new Map([
  ['dynamicPiano', 'p'],
  ['dynamicMezzo', 'm'],
  ['dynamicForte', 'f'],
  ['dynamicRinforzando', 'r'],
  ['dynamicSforzando', 's'],
  ['dynamicZ', 'z'],
  ['dynamicNiente', 'n'],
  ['dynamicPPPPPP', 'pppppp'],
  ['dynamicPPPPP', 'ppppp'],
  ['dynamicPPPP', 'pppp'],
  ['dynamicPPP', 'ppp'],
  ['dynamicPP', 'pp'],
  ['dynamicMP', 'mp'],
  ['dynamicMF', 'mf'],
  ['dynamicPF', 'pf'],
  ['dynamicFF', 'ff'],
  ['dynamicFFF', 'fff'],
  ['dynamicFFFF', 'ffff'],
  ['dynamicFFFFF', 'fffff'],
  ['dynamicFFFFFF', 'ffffff'],
  ...[...ACCENT_GLYPHS].map(([letters, glyph]) => [glyph, letters] as const),
])

// The words that state a level against the one before it, and whether each
// moves towards the mark. "più f" is louder and "più p" softer, and "meno"
// turns either round.
const RELATIVE_WORDS = new Map([
  ['più', true],
  ['piu', true],
  ['piú', true],
  ['meno', false],
])

/**
 * Which way the level moves where the wording before the mark ends with più
 * or meno, or nothing where it states no change. Niente has no side to move
 * towards.
 */
function relativeValue(wording: string, value: DynamicValue): RelativeDynamicValue | undefined {
  // The last word: everything after the last space.
  const word = wording.replace(/^.*\s/su, '').toLowerCase()
  const towards = RELATIVE_WORDS.get(word)
  if (towards === undefined || value === 'n') return undefined
  return value.includes('f') === towards ? 'louder' : 'softer'
}

type Mark =
  | { kind: 'immediate'; value: DynamicValue; glyphs: readonly string[] }
  | { kind: 'accent'; spelling: AccentSpelling; glyphs: readonly string[] }

function namedMark(name: string): Mark | undefined {
  const spelling = ACCENT_SPELLINGS.get(name)
  const glyph = ACCENT_GLYPHS.get(name)
  if (spelling !== undefined && glyph !== undefined)
    return { kind: 'accent', spelling, glyphs: [glyph] }
  return isDynamicValue(name) ? { kind: 'immediate', value: name, glyphs: [] } : undefined
}

/**
 * The mark an <other-dynamics> spells out in letters, such as "sff", which
 * MusicXML has no element for, or draws as a SMuFL glyph alone. A glyph the
 * source names is the mark's own.
 */
function writtenMark(
  mark: XmlElement,
  written: string,
  warnings: WarningCollector,
  context: ReportContext,
): Mark | undefined {
  const glyph = attribute(mark, 'smufl')
  const drawn = glyph === undefined ? undefined : GLYPH_LETTERS.get(glyph)
  const letters = written === '' ? drawn : written
  if (letters === undefined) return undefined
  const spelling = ACCENT_SPELLINGS.get(letters)
  const found: Mark | undefined =
    spelling !== undefined
      ? { kind: 'accent', spelling, glyphs: [] }
      : isDynamicValue(letters)
        ? { kind: 'immediate', value: letters, glyphs: [] }
        : undefined
  if (found === undefined) return undefined

  // A glyph drawing other letters than the text would draw another mark.
  const contradicts = drawn !== undefined && drawn !== letters
  if (contradicts) {
    warnings.add(
      'inconsistent:dynamic-glyph',
      `A dynamic is written "${letters}" and names the glyph "${glyph}", which draws ` +
        `"${drawn}". The text is the mark converted, and the glyph is not.`,
      context,
      mark,
      'smufl',
    )
  }
  return glyph === undefined || contradicts ? found : { ...found, glyphs: [glyph] }
}

export function readDynamics(
  element: ElementReader,
  position: Fraction,
  staff: number | undefined,
  placement: 'above' | 'below' | undefined,
  wording: PendingWording,
  warnings: WarningCollector,
  context: ReportContext,
): Dynamic[] {
  const dynamics: Dynamic[] = []

  const marks = element.element.children
  // Where the pieces a split mark took in run out.
  let joinedTo = 0
  for (const [index, mark] of marks.entries()) {
    element.read(mark)
    if (index < joinedTo) continue
    const split = splitMark(marks, index)
    let found: Mark | undefined
    if (split !== undefined) {
      joinedTo = index + split.pieces
      found = split.mark
      // The glyphs a split mark is drawn with are its own.
      for (const piece of marks.slice(index, joinedTo)) attribute(piece, 'smufl')
    } else if (mark.name === 'other-dynamics') {
      const written = trimmedText(mark)
      found = writtenMark(mark, written, warnings, context)
      if (found === undefined) {
        // The glyph is reported before the text is read: an element naming a
        // glyph and holding no text still says something the output cannot.
        reportWordingGlyph(mark, written, warnings, context)
        if (written !== '') wording.push(mark)
        continue
      }
    } else {
      found = namedMark(mark.name)
    }
    if (found?.kind === 'immediate') {
      const prefix = wording.take()
      const relative = prefix && relativeValue(prefix.text, found.value)
      dynamics.push({
        ...(relative
          ? { kind: 'relative', relativeValue: relative }
          : { kind: 'immediate' as const }),
        position,
        value: found.value,
        ...(found.glyphs.length > 0 ? { glyphs: found.glyphs } : {}),
        staff,
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(placement !== undefined ? { placement } : {}),
      })
    } else if (found) {
      const prefix = wording.take()
      dynamics.push({
        kind: 'accent',
        position,
        value: found.spelling.value,
        residualValue: found.spelling.residualValue,
        accentPrefix: found.spelling.prefix,
        accentSuffix: found.spelling.suffix,
        glyphs: found.glyphs,
        staff,
        ...(prefix !== undefined ? { prefix: prefix.text } : {}),
        ...(placement !== undefined ? { placement } : {}),
      })
    } else {
      warnings.addWhole(
        'unsupported:element',
        `A dynamic of "${mark.name}" is not converted yet.`,
        context,
        mark,
      )
      // The wording opened this mark, so it goes with it.
      const orphaned = wording.take()
      if (orphaned)
        warnings.add(
          'unsupported:element',
          `A dynamic wording of "${orphaned.text}" is not converted yet, because the ` +
            `"${mark.name}" it qualifies is not.`,
          context,
          orphaned.element,
        )
    }
  }

  // Wording still pending is left in the holder: the mark it qualifies may
  // sit in a sibling <dynamics> block or be the <wedge> beside this one, and
  // whatever is left once the <direction-type> runs out is settled there.
  return dynamics
}

/**
 * The mark spelled by two or more pieces of one <dynamics>, starting at
 * `start`, and how many pieces it takes. MusicXML combines the marks in one
 * <dynamics> to spell one it has no element for, such as sfmp, and a source
 * may split the letters of any mark that way: s and f, or ff and z. The
 * longest run that spells a mark is taken. A space between two pieces keeps
 * them apart. A piece naming a glyph is the source's own drawing of it, so it
 * joins only other pieces drawn as glyphs alone, one glyph per letter, and
 * the mark carries those glyphs.
 */
function splitMark(
  marks: readonly XmlElement[],
  start: number,
): { mark: Mark; pieces: number } | undefined {
  const letters: string[] = []
  const glyphs: string[] = []
  const glyphOnly = (piece: XmlElement): string | undefined => {
    // Only an <other-dynamics> names a glyph.
    return text(piece).trim() === '' ? peekAttribute(piece, 'smufl') : undefined
  }
  const drawnAsGlyphs = marks[start] !== undefined && glyphOnly(marks[start]) !== undefined
  for (const piece of marks.slice(start)) {
    const glyph = glyphOnly(piece)
    const drawn = glyph === undefined ? undefined : GLYPH_LETTERS.get(glyph)
    if (drawnAsGlyphs) {
      if (glyph === undefined || drawn === undefined) break
      letters.push(drawn)
      glyphs.push(glyph)
    } else if (piece.name !== 'other-dynamics') letters.push(piece.name)
    else if (peekAttribute(piece, 'smufl') === undefined) letters.push(text(piece))
    else break
  }
  for (let pieces = letters.length; pieces > 1; pieces -= 1) {
    const written = letters.slice(0, pieces).join('').trim()
    const drawn = glyphs.slice(0, pieces)
    const spelling = ACCENT_SPELLINGS.get(written)
    if (spelling !== undefined) {
      return { mark: { kind: 'accent', spelling, glyphs: drawn }, pieces }
    }
    if (isDynamicValue(written)) {
      return { mark: { kind: 'immediate', value: written, glyphs: drawn }, pieces }
    }
  }
  return undefined
}

/**
 * Report the glyph a source names for its wording. MNX states glyphs for the
 * dynamic mark itself, so putting one there would redraw the mark, not the
 * words. The wording goes over as text and the glyph is reported.
 *
 * The two cases are different kinds of loss. A glyph with no text that
 * draws no mark GLYPH_LETTERS reads is a converter gap. A glyph named for
 * words that also convert has no home, because the schema nowhere states how
 * the wording is drawn: a format limit.
 */
function reportWordingGlyph(
  element: XmlElement,
  wording: string,
  warnings: WarningCollector,
  context: ReportContext,
): void {
  const glyph = attribute(element, 'smufl')
  if (glyph === undefined) return
  if (wording === '') {
    warnings.add(
      'unsupported:element',
      `A dynamic drawn only as the glyph "${glyph}" is not converted yet, because the ` +
        'glyph draws no mark the converter reads.',
      context,
      element,
      'smufl',
    )
  } else {
    warnings.add(
      'unrepresentable:wording-glyph',
      `The glyph named for the dynamic wording "${wording}" is drawn as text instead, ` +
        'because MNX states a glyph for the dynamic mark, not for its wording.',
      context,
      element,
      'smufl',
    )
  }
}
