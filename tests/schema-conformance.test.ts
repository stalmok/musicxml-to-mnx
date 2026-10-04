// Compares what the converter states about MNX by hand with the vendored
// schema. tests/support/schema.ts checks only the emitted documents. Three
// places state MNX facts by hand:
//
//   src/types/mnx.ts             these are MNX's fields and enums
//   src/read/unrepresentable.ts  these elements have no home in MNX
//   src/ids.ts                   an MNX id looks like this
//
// A fourth, the model's enums in src/model/score.ts, copies the types, because
// the model uses MNX's spelling. It is compared with the types at the end of
// this file.
//
// Neither kind of drift shows elsewhere. A field the types lack is never
// emitted, and the output stays legal because the field is optional. A
// registry entry for something the schema has since gained goes on reporting
// a permanent format limit. The loss report is driven by the input, so it
// cannot see either.
//
// Run this after moving the schema pin.

import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { BASE_VALUES } from '../src/read/duration.js'
import { MNX_ID_PATTERN } from '../src/ids.js'
import { NO_HOME_ATTRIBUTES, NO_HOME_IN_MNX } from '../src/read/unrepresentable.js'
import { resolveRef, schemaDefs } from './support/schema.js'
import type { SchemaNode } from './support/schema.js'

describe('the id pattern the reader renames parts by', () => {
  test('matches the schema it was copied from', () => {
    // src/ids.ts holds a copy, because the schema and ajv are dev-only and a
    // conversion must not need either.
    expect(MNX_ID_PATTERN.source).toBe(schemaDefs['id']?.pattern)
  })
})

describe('the instrument id a sound is keyed by', () => {
  // The reader renames a part id MNX cannot state. The writer passes the
  // <score-instrument> id into global.sounds as a key, unchecked. These three
  // schema facts make that safe. When one stops holding, the instrument id
  // needs the renaming the part id gets.

  test('the schema puts no shape on a sounds key', () => {
    // Any instrument id is a legal key, including one with accented letters,
    // which MNX's id cannot state.
    expect(Object.keys(schemaDefs['sounds-global']?.patternProperties ?? {})).toEqual(['^.*$'])
  })

  test('a percussion kit is the only thing that names a sound', () => {
    expect(usedBy('sound')).toEqual(['kit-component', 'sound'])
  })

  test('a kit component is what the types name a sound from', () => {
    expect(mnxTypes.get('MNXKitComponent')?.has('sound')).toBe(true)
  })
})

// A tuplet whose ratio no pair of note values states is reported as a format
// limit (unrepresentable:tuplet-ratio). That rests on what the schema says a
// ratio is counted in.
describe('the note values a tuplet ratio is counted in', () => {
  const named = schemaDefs['note-value-base']?.enum ?? []

  test('every value the converter writes is one the schema names', () => {
    expect(Object.keys(BASE_VALUES).filter((base) => !named.includes(base))).toEqual([])
  })

  test('every value the schema names and the converter does not is accounted for', () => {
    // MusicXML's <note-type-value> stops at a 1024th and has no duplex maxima,
    // so no source can ask for these three.
    expect(named.filter((base) => !(String(base) in BASE_VALUES))).toEqual([
      'duplexMaxima',
      '2048th',
      '4096th',
    ])
  })

  test('each side of a ratio is a value counted a whole number of times', () => {
    const quantity = schemaDefs['note-value-quantity']

    expect([...(quantity?.required ?? [])].sort()).toEqual(['duration', 'multiple'])
    expect(resolveRef(quantity?.properties?.['duration'])).toBe(schemaDefs['note-value'])
    expect(resolveRef(quantity?.properties?.['multiple'])).toBe(schemaDefs['positive-integer'])
  })

  test('the schema puts no bound on how many of a value a ratio counts', () => {
    // The reader states whatever count the notes come to, with no limit of
    // its own.
    expect(schemaDefs['positive-integer']?.maximum).toBeUndefined()
  })

  test('a ratio counts at least one of a value on each side', () => {
    // A bracket holding nothing that takes any of the measure's time is
    // reported as a format limit (unrepresentable:tuplet-untimed). That rests
    // on this minimum.
    expect(schemaDefs['positive-integer']?.minimum).toBe(1)
  })

  test('every value the converter writes lasts a power of two of a whole note', () => {
    // A quarter sounding a sixth of a whole note is one quarter in the time of
    // two thirds of a quarter, and no power of two counts both sides of that.
    for (const length of Object.values(BASE_VALUES)) {
      expect(Math.log2(length.num * length.den) % 1).toBe(0)
      expect(length.num === 1 || length.den === 1).toBe(true)
    }
  })
})

// A bracket over grace notes alone takes none of the measure's time, and is
// reported as a format limit (unrepresentable:tuplet-untimed). That also rests
// on a grace group having no room for a tuplet.
describe('what a grace group holds', () => {
  test('a grace group holds events and nothing else', () => {
    expect(resolveRef(schemaDefs['grace']?.properties?.['content']?.items)).toBe(
      schemaDefs['event'],
    )
  })
})

// --- The MNX types against the schema ---------------------------------------

/**
 * Every exported MNX* interface, with the properties it declares, whether each
 * is optional, and the members of any literal union. Inherited properties are
 * included, so MNXStrongAccent carries MNXMarking's placement.
 *
 * Read through the compiler, because the types use `extends` and named
 * aliases, which must be resolved.
 */
function readMnxTypes(): Map<string, Map<string, { optional: boolean; union: string[] | null }>> {
  const file = fileURLToPath(new URL('../src/types/mnx.ts', import.meta.url))
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  if (source === undefined) throw new Error('src/types/mnx.ts did not compile.')

  const found = new Map<string, Map<string, { optional: boolean; union: string[] | null }>>()
  ts.forEachChild(source, (node) => {
    if (!ts.isInterfaceDeclaration(node)) return
    const symbol = checker.getSymbolAtLocation(node.name)
    if (symbol === undefined) return

    const properties = new Map<string, { optional: boolean; union: string[] | null }>()
    for (const property of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))) {
      const type = checker.getTypeOfSymbolAtLocation(property, node)
      const parts = type.isUnion() ? type.types : [type]
      // Undefined is how an optional property reads; the union is about the
      // values it can hold.
      const stated = parts.filter((part) => (part.flags & ts.TypeFlags.Undefined) === 0)
      // Numbers as well as text: the schema enumerates an octave shift's
      // amount and a time signature's unit as numbers.
      const literals = stated.filter((part) => part.isStringLiteral() || part.isNumberLiteral())
      properties.set(property.getName(), {
        optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
        union:
          literals.length === stated.length && literals.length > 0
            ? literals.map((literal) => String(literal.value)).sort()
            : null,
      })
    }
    found.set(node.name.text, properties)
  })
  return found
}

/**
 * Which schema definition each type models. Most map by turning the name into
 * kebab-case, so only the ones that do not are listed. A type mapped to
 * undefined models no single definition and is checked by whatever uses it.
 */
const DEFINITION_OF: Readonly<Record<string, string | undefined>> = {
  MNXDocument: 'root',
  MNXFormat: 'mnx',
  MNXImmediateDynamic: 'dynamic-group-immediate',
  MNXGradualDynamic: 'dynamic-group-gradual',
  MNXRelativeDynamic: 'dynamic-group-relative',
  MNXAccentDynamic: 'dynamic-group-accent',
  MNXGlobalMeasure: 'measure-global',
  MNXGraceGroup: 'grace',
  MNXLayoutStaff: 'staff',
  MNXLyricLine: 'event-lyric-line',
  MNXSingleNoteTremolo: 'tremolo-single',
  MNXPartTransposition: 'part-transposition',
  // A shared base for the marking types. The schema spells each mark out
  // (accent, staccato, ...) as a bare placement, which MNXEventMarkings'
  // properties already reach.
  MNXMarking: undefined,
  // A shared base for the four dynamic types. Each of them is checked whole.
  MNXDynamicBase: undefined,
}

/**
 * The three properties $defs/global-attrs gives nearly every object. They are
 * checked once, below, and left out of the per-type comparison: id is written
 * only where something points at a node, and _c and _x are not modelled.
 */
const GLOBAL_ATTRIBUTES = ['id', '_c', '_x']

/** The reason every dynamic type shares. */
const DYNAMIC_NOT_MODELLED = 'A continued dynamic, and the voice a mark belongs to.'

/**
 * Schema properties the types do not model, with the reason. The writer
 * cannot produce any of them yet. A difference not listed here fails.
 */
const NOT_MODELLED: Readonly<Record<string, { properties: readonly string[]; why: string }>> = {
  MNXNote: {
    properties: ['perform', 'written'],
    why: 'Playback, and a written pitch differing from the sounding one.',
  },
  MNXSlur: {
    properties: ['endNote', 'startNote'],
    why: 'A slur pinned to particular notes of the two chords it joins.',
  },
  MNXTuplet: {
    properties: ['staff'],
    why: 'A tuplet drawn on a staff other than the one its voice sits on.',
  },
  MNXGraceGroup: {
    properties: ['color'],
    why: 'The colour a grace group is drawn in.',
  },
  MNXMultiNoteTremolo: {
    properties: ['individualDuration'],
    why: 'The value each note of the pair is played at, as against the value they are written with.',
  },
  MNXSequence: {
    properties: ['directionHint'],
    why: 'Whether a voice is the upper or the lower one. MusicXML states no such thing.',
  },
  MNXClef: {
    properties: ['color', 'glyph'],
    why: 'The colour a clef is drawn in, and a glyph in place of its sign.',
  },
  MNXImmediateDynamic: { properties: ['visuallyContinues', 'voice'], why: DYNAMIC_NOT_MODELLED },
  MNXGradualDynamic: {
    properties: ['staffEnd', 'visuallyContinues', 'voice'],
    why: `A hairpin ending on another staff. ${DYNAMIC_NOT_MODELLED}`,
  },
  MNXRelativeDynamic: { properties: ['visuallyContinues', 'voice'], why: DYNAMIC_NOT_MODELLED },
  MNXAccentDynamic: { properties: ['visuallyContinues', 'voice'], why: DYNAMIC_NOT_MODELLED },
  MNXOttava: { properties: ['voice'], why: 'The voice an octave shift applies to.' },
  MNXMeasureRepeat: {
    properties: ['counter', 'displayNumber', 'staffPosition'],
    why: 'How a simile sign is drawn and counted.',
  },
  MNXKitNote: {
    properties: ['perform'],
    why: 'How a kit note is played back, which the schema states nothing about yet.',
  },
  MNXStaffSource: {
    properties: ['stem', 'voice'],
    why: 'Drawing one voice of a part on a staff, with its stems forced one way.',
  },
  MNXKey: { properties: ['color'], why: 'The colour a key signature is drawn in.' },
  MNXFine: { properties: ['color'], why: 'The colour a Fine is drawn in.' },
  MNXEnding: { properties: ['color'], why: 'The colour an ending bracket is drawn in.' },
  MNXLyricsGlobal: {
    properties: ['lineMetadata'],
    why: 'A label and language for each verse line.',
  },
  MNXSystem: {
    properties: ['layout', 'layoutChanges'],
    why: 'A system taking its own layout, or changing layout partway.',
  },
  MNXPage: { properties: ['layout'], why: 'A page taking its own layout.' },
}

/** The properties a definition states, ignoring the ones every object gets. */
function schemaProperties(definition: SchemaNode): string[] {
  return Object.keys(definition.properties ?? {}).filter(
    (name) => !GLOBAL_ATTRIBUTES.includes(name),
  )
}

/**
 * The values a property may hold, where the schema enumerates them, as text.
 */
function schemaUnion(definition: SchemaNode, property: string): string[] | null {
  const resolved = resolveRef(definition.properties?.[property])
  if (resolved?.enum !== undefined) {
    return resolved.enum.map((value) => String(value)).sort()
  }
  if (resolved?.const !== undefined) return [String(resolved.const)]
  return null
}

const mnxTypes = readMnxTypes()

describe('the hand-written MNX types against the schema', () => {
  test('every exported interface is mapped to a definition or explicitly left unmapped', () => {
    const unmapped = [...mnxTypes.keys()].filter((name) => {
      if (name in DEFINITION_OF) return false
      return !(kebab(name) in schemaDefs)
    })
    expect(unmapped).toEqual([])
  })

  test('the properties every object inherits are still the three that are left out', () => {
    // If MNX adds a fourth, the per-type comparison reports it for every
    // type. This test names the cause.
    expect(Object.keys(schemaDefs['global-attrs']?.properties ?? {}).sort()).toEqual(
      [...GLOBAL_ATTRIBUTES].sort(),
    )
  })

  // The per-type comparison below passes over a definition it cannot find,
  // so a definition MNX removes or renames is caught here.
  test('every type mapped by hand still exists, mapped to a definition the schema still has', () => {
    expect(Object.keys(DEFINITION_OF).filter((name) => !mnxTypes.has(name))).toEqual([])
    expect(
      Object.entries(DEFINITION_OF).filter(([, key]) => key !== undefined && !(key in schemaDefs)),
    ).toEqual([])
  })

  const mapped = [...mnxTypes.entries()].flatMap(([name, properties]) => {
    const key = name in DEFINITION_OF ? DEFINITION_OF[name] : kebab(name)
    if (key === undefined) return []
    const definition = schemaDefs[key]
    if (definition === undefined) return []
    return [{ name, key, properties, definition }]
  })

  test.each(mapped)('$name models every property of $key', ({ name, properties, definition }) => {
    const stated = schemaProperties(definition)
    const modelled = [...properties.keys()].filter((one) => !GLOBAL_ATTRIBUTES.includes(one))
    const allowed = NOT_MODELLED[name]?.properties ?? []

    // Schema properties the types lack and the allowlist does not name.
    expect(
      stated.filter((one) => !modelled.includes(one) && !allowed.includes(one)).sort(),
    ).toEqual([])
    // Properties the schema has no room for, caught before anything emits
    // them.
    expect(modelled.filter((one) => !stated.includes(one)).sort()).toEqual([])
    // An allowlist entry for a property the schema no longer has is stale.
    expect(allowed.filter((one) => !stated.includes(one)).sort()).toEqual([])
  })

  test.each(mapped)(
    '$name agrees with $key about what is required',
    ({ properties, definition }) => {
      const required = definition.required ?? []
      const wrong: string[] = []
      for (const [property, { optional }] of properties) {
        if (GLOBAL_ATTRIBUTES.includes(property)) continue
        if (!schemaProperties(definition).includes(property)) continue
        if (required.includes(property) === optional) {
          wrong.push(
            `${property}: schema ${required.includes(property) ? 'requires' : 'makes optional'}`,
          )
        }
      }
      expect(wrong).toEqual([])
    },
  )

  test.each(mapped)('$name enumerates the same values as $key', ({ properties, definition }) => {
    const wider: string[] = []
    const narrower: string[] = []
    for (const [property, { union }] of properties) {
      if (union === null) continue
      const stated = schemaUnion(definition, property)
      if (stated === null) continue
      const extra = union.filter((value) => !stated.includes(value))
      const missing = stated.filter((value) => !union.includes(value))
      // A wider type permits output that is not legal MNX. A narrower one
      // cannot describe some legal documents.
      if (extra.length > 0) wider.push(`${property}: ${extra.join(', ')}`)
      if (missing.length > 0) narrower.push(`${property}: ${missing.join(', ')}`)
    }
    expect(wider).toEqual([])
    expect(narrower).toEqual([])
  })
})

/** MNXGlobalMeasure into global-measure, which is how most names map. */
function kebab(name: string): string {
  return name
    .replace(/^MNX/, '')
    .replace(/(?<!^)(?=[A-Z])/g, '-')
    .toLowerCase()
}

// --- The registry of what MNX cannot hold, against the schema ---------------

/**
 * Every name the schema uses, normalised, against the definitions that use it.
 * A MusicXML name is hyphenated and an MNX one is camelCase, so only letters
 * and digits are kept: key-octave matches keyOctave.
 */
function schemaNames(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const note = (name: string, where: string): void => {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const places = found.get(key) ?? new Set<string>()
    places.add(where)
    found.set(key, places)
  }
  for (const [definition, node] of Object.entries(schemaDefs)) {
    note(definition, definition)
    for (const property of Object.keys(node.properties ?? {})) note(property, definition)
    for (const value of node.enum ?? []) {
      if (typeof value === 'string') note(value, definition)
    }
  }
  return found
}

const names = schemaNames()

/** Where the schema uses a name, ignoring case and hyphens. */
function usedBy(name: string): string[] {
  return [...(names.get(name.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? [])].sort()
}

/**
 * Element names on the no-home list that the schema also uses, with a
 * different meaning, and the definitions that use them. Every other name on
 * that list must be absent from the schema.
 */
const ELEMENT_COLLISIONS: Readonly<Record<string, readonly string[]>> = {
  // MusicXML's <bracket> is a line drawn over a passage. The schema's brackets
  // are a staff symbol and the one a tuplet is drawn with, and neither spans a
  // passage.
  bracket: ['staff-symbol', 'tuplet'],
  // MusicXML's <system-layout> is page spacing. MNX's system-layout is the
  // arrangement of staves in a system.
  'system-layout': ['system-layout'],
  // MusicXML's <string> is the string a note is played on. The schema's
  // string is the JSON text type every other definition is built from.
  string: ['string'],
  // MusicXML's <arrow> is an arrow drawn on a note to show how it is played.
  // The schema's arrow says whether a rolled chord is drawn with an
  // arrowhead.
  arrow: ['arpeggio'],
  // MusicXML's <open> is an open string, or an open valve or hole. The
  // schema's open says whether a repeat ending is left unclosed.
  open: ['ending'],
}

/**
 * The definition that would hold each attribute on the no-home list. The test
 * checks that the definition has no such property. Attributes with no home
 * anywhere in the schema are listed after it.
 */
const ATTRIBUTE_HOMES: Readonly<Record<string, string>> = {
  'dot placement': 'note-value',
  'note dynamics': 'perform-options',
  'sound dynamics': 'sound',
  'sound pan': 'sound',
  'sound elevation': 'sound',
  'sound pizzicato': 'event-markings',
  'sound segno': 'segno',
  'clef after-barline': 'clef',
  'caesura placement': 'caesura',
  'tied line-type': 'tie',
  'metronome parentheses': 'tempo',
  'direction system': 'system',
  'measure implicit': 'measure-global',
}

const HIDING = ['visible', 'invisible', 'hidden', 'print-object']

/** Attributes whose comment claims the schema has no such concept anywhere. */
const ATTRIBUTES_NOWHERE: Readonly<Record<string, readonly string[]>> = {
  // No cue and no size concept.
  'type size': ['size', 'cue'],
  // The same fact the <pedal> element rests on.
  'sound damper-pedal': ['pedal'],
  'sound soft-pedal': ['pedal'],
  'sound sostenuto-pedal': ['pedal'],
  // No visibility of any kind.
  'note print-object': HIDING,
  'notations print-object': HIDING,
  'key print-object': HIDING,
  'time print-object': HIDING,
  'ending print-object': HIDING,
  'lyric print-object': HIDING,
  // The same fact <staff-tuning>, <capo> and <fret> rest on: no tablature.
  // <string> is left out, because the schema's "string" is the JSON type, as
  // ELEMENT_COLLISIONS records.
  'staff-details show-frets': ['tablature', 'tuning', 'fret', 'capo'],
}

/** Attributes whose home would be a wider jump-type, not a property. */
const ATTRIBUTES_NEEDING_A_JUMP = ['sound dacapo', 'sound tocoda', 'sound coda']

describe('the registry of what MNX cannot hold, against the schema', () => {
  test.each([...NO_HOME_IN_MNX])('the schema has nowhere for <%s>', (element) => {
    // No definition in the schema could hold it. A name the schema has gained
    // is a converter gap, not a format limit.
    expect(usedBy(element)).toEqual([...(ELEMENT_COLLISIONS[element] ?? [])].sort())
  })

  test('every collision exception names an element still on the list', () => {
    expect(Object.keys(ELEMENT_COLLISIONS).filter((one) => !NO_HOME_IN_MNX.has(one))).toEqual([])
  })

  test('every attribute on the list states which fact it rests on', () => {
    const stated = new Set([
      ...Object.keys(ATTRIBUTE_HOMES),
      ...Object.keys(ATTRIBUTES_NOWHERE),
      ...ATTRIBUTES_NEEDING_A_JUMP,
    ])
    expect([...NO_HOME_ATTRIBUTES].filter((one) => !stated.has(one))).toEqual([])
    expect([...stated].filter((one) => !NO_HOME_ATTRIBUTES.has(one))).toEqual([])
  })

  test.each(Object.entries(ATTRIBUTE_HOMES))(
    'the definition that would hold %s has no such property',
    (entry, definition) => {
      const attribute = entry.slice(entry.indexOf(' ') + 1)
      const wanted = attribute.toLowerCase().replace(/[^a-z0-9]/g, '')
      const held = Object.keys(schemaDefs[definition]?.properties ?? {}).map((one) =>
        one.toLowerCase().replace(/[^a-z0-9]/g, ''),
      )
      expect(held).not.toContain(wanted)
    },
  )

  test.each(Object.entries(ATTRIBUTES_NOWHERE))(
    'the schema has no concept behind %s',
    (_entry, concepts) => {
      expect(concepts.flatMap((concept) => usedBy(concept))).toEqual([])
    },
  )

  test.each(ATTRIBUTES_NEEDING_A_JUMP)('%s would need a jump type the schema lacks', () => {
    // MNX jumps to a segno or plays to a Fine, and names nothing else, so a
    // da capo, a to-coda and a coda have no home in MNX.
    expect(schemaDefs['jump-type']?.enum).toEqual(['dsalfine', 'segno'])
  })
})

// --- The model's enums against the MNX ones they are spelled from -----------
//
// The model's enums use MNX's words (docs/architecture.md), so the writer
// needs no second table. Each is a copy of an MNX enum.
//
// The writer assigns a model value into an MNX field, so a model enum with a
// member MNX lacks does not compile. The other direction needs this test: an
// MNX member the model lacks is a value the converter never produces, and the
// output stays legal.
//
// Every enum the model states is paired with an MNX one or says why not.
// Every enum MNX states is reached by a pairing or says why the model does not
// restate it.

/** The model's own tag for a sequence item, which MNX states as a type. */
const SEQUENCE_ITEM_TAG =
  'The model tags a sequence item with kind, and the writer states MNX type from it. The two do not always spell it alike: the model says multiNoteTremolo where MNX says tremolo.'

/** Why the model states nothing about a relative dynamic. */
const RELATIVE_NOT_CONVERTED =
  'Relative dynamics are not converted: MusicXML writes più f as words beside a mark.'

/** The model's own tag for a dynamic, which MNX states as a type. */
const DYNAMIC_TAG =
  'The model tags a dynamic with kind, spelled as MNX spells its type, and the writer states MNX type from it.'

/** The same, for what a system's layout is built from. */
const GROUPING_ITEM_TAG =
  'The model tags a grouping item with kind, and the writer states MNX type from it. The model says part, where MNX says the staff that part is drawn on.'

/** The reason most of the narrowings below share. */
const UNSTATED_IS_UNDEFINED =
  'MNX names a value auto for what the source did not state; the model leaves it undefined, so the writer omits the field and a renderer decides.'

/**
 * Each model enum, against the MNX type it is spelled from. An enum written
 * inline on an interface is named Interface.property.
 */
const MNX_SPELLING: Readonly<Record<string, string>> = {
  Step: 'MNXStep',
  NoteValueBase: 'MNXNoteValueBase',
  ClefSign: 'MNXClefSign',
  PitchedClefSign: 'MNXClefSign',
  CurveSide: 'MNXCurveSide',
  LineType: 'MNXLineType',
  FermataSymbol: 'MNXFermataSymbol',
  TupletDisplay: 'MNXTupletDisplaySetting',
  AccentPrefix: 'MNXAccentDynamic.accentPrefix',
  AccentSuffix: 'MNXAccentDynamic.accentSuffix',
  DynamicValue: 'MNXDynamicValue',
  WedgeType: 'MNXWedgeType',
  OttavaAmount: 'MNXOttavaAmount',
  TimeUnit: 'MNXTimeSignatureUnit',
  BarlineType: 'MNXBarlineType',
  JumpType: 'MNXJumpType',
  'AccidentalDisplay.enclosure': 'MNXAccidentalEnclosureSymbol',
  'Event.stemDirection': 'MNXEvent.stemDirection',
  'PartGroup.symbol': 'MNXStaffSymbol',
  'PartGroup.barlineStyle': 'MNXStaffGroupBarlineStyle',
  'TimeSignature.display': 'MNXTime.display',
  'Lyric.type': 'MNXLyricLineType',
  GraceType: 'MNXGraceType',
  CaesuraShape: 'MNXCaesuraShape',
  BreathSymbol: 'MNXBreathMarkSymbol',
  'Marking.placement': 'MNXPlacement',
  'StrongAccentMarking.pointing': 'MNXStrongAccent.pointing',
  'BowDirectionMarking.direction': 'MNXBowDirection.direction',
  'Fermata.placement': 'MNXPlacement',
  'Fermata.pointing': 'MNXFermata.pointing',
  'Tuplet.placement': 'MNXPlacement',
  'Tuplet.bracket': 'MNXTuplet.bracket',
  'DynamicBase.placement': 'MNXMultiStaffPlacement',
  'Ottava.placement': 'MNXPlacement',
  'Arpeggio.direction': 'MNXArpeggio.direction',
  'Beam.direction': 'MNXBeamHookDirection',
}

/** A model enum MNX states as something other than a value, with what it is. */
const NOT_AN_MNX_ENUM: Readonly<Record<string, string>> = {
  MarkingKind: 'MNX gives each mark a property of its own on event markings.',
  'CaesuraMarking.marks': 'MNX states the stroke count as an integer from 1 to 2.',
  'Event.kind': SEQUENCE_ITEM_TAG,
  'Space.kind': SEQUENCE_ITEM_TAG,
  'Tuplet.kind': SEQUENCE_ITEM_TAG,
  'GraceGroup.kind': SEQUENCE_ITEM_TAG,
  'MultiNoteTremolo.kind': SEQUENCE_ITEM_TAG,
  'ImmediateDynamic.kind': DYNAMIC_TAG,
  'GradualDynamic.kind': DYNAMIC_TAG,
  'AccentDynamic.kind': DYNAMIC_TAG,
}

/**
 * Where the model states fewer values than MNX, and why. A difference not
 * listed here fails.
 */
const NARROWER: Readonly<Record<string, { missing: readonly string[]; why: string }>> = {
  NoteValueBase: {
    missing: ['2048th', '4096th', 'duplexMaxima'],
    why: 'No MusicXML <type> spells any of the three, so the reader cannot produce one.',
  },
  PitchedClefSign: {
    missing: ['P'],
    why: 'The signs a pitch is read against. A percussion clef places no pitch.',
  },
  CurveSide: { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Lyric.type': {
    missing: ['whole'],
    why: 'A syllable that is a whole word states no type at all.',
  },
  'Marking.placement': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Fermata.placement': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Tuplet.placement': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Ottava.placement': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'StrongAccentMarking.pointing': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Fermata.pointing': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Tuplet.bracket': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Arpeggio.direction': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'Beam.direction': { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  BreathSymbol: { missing: ['auto'], why: UNSTATED_IS_UNDEFINED },
  'DynamicBase.placement': {
    missing: ['auto', 'between'],
    why: `${UNSTATED_IS_UNDEFINED} A dynamic written between two staves of one part is not read.`,
  },
  'PartGroup.barlineStyle': {
    missing: ['instrument'],
    why: "MusicXML's <group-barline> says yes, no or Mensurstrich, and none of them means one line per instrument.",
  },
}

/**
 * Every union of literal values a file states, by name, as a named alias or
 * inline on an interface property. An inline one is named Interface.property.
 * Read through the compiler, because a union can state its members through
 * named aliases.
 *
 * A property whose type is a named alias is left out, because the alias is
 * already listed under its own name.
 */
function readUnions(path: string): Map<string, string[]> {
  const file = fileURLToPath(new URL(path, import.meta.url))
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  if (source === undefined) throw new Error(`${path} did not compile.`)

  /** The values a type states, or nothing where it states something else. */
  const valuesOf = (type: ts.Type): string[] | undefined => {
    const parts = type.isUnion() ? type.types : [type]
    // Undefined is how the model writes a value it may not have; the union is
    // about the values it can hold.
    const stated = parts.filter((part) => (part.flags & ts.TypeFlags.Undefined) === 0)
    const literals = stated.filter((part) => part.isStringLiteral() || part.isNumberLiteral())
    // A union of interfaces, such as SequenceItem, states no values, and a
    // union mixing literals with anything else is not a vocabulary.
    if (literals.length !== stated.length || literals.length === 0) return undefined
    return literals.map((literal) => String(literal.value)).sort()
  }

  /** A type written out of literals here, rather than named elsewhere. */
  const isWrittenInline = (node: ts.TypeNode | undefined): boolean => {
    if (node === undefined) return false
    const parts = ts.isUnionTypeNode(node) ? node.types : [node]
    const stated = parts.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword)
    return stated.length > 0 && stated.every((part) => ts.isLiteralTypeNode(part))
  }

  const found = new Map<string, string[]>()
  ts.forEachChild(source, (node) => {
    if (ts.isTypeAliasDeclaration(node)) {
      const symbol = checker.getSymbolAtLocation(node.name)
      if (symbol === undefined) return
      const values = valuesOf(checker.getDeclaredTypeOfSymbol(symbol))
      if (values) found.set(node.name.text, values)
      return
    }
    if (!ts.isInterfaceDeclaration(node)) return
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !isWrittenInline(member.type)) continue
      const symbol = checker.getSymbolAtLocation(member.name)
      if (symbol === undefined) continue
      const values = valuesOf(checker.getTypeOfSymbolAtLocation(symbol, node))
      if (values) found.set(`${node.name.text}.${member.name.getText()}`, values)
    }
  })
  return found
}

const modelUnions = readUnions('../src/model/score.ts')
const mnxUnions = readUnions('../src/types/mnx.ts')

/**
 * An MNX enum the model does not restate, with the reason. Either the writer
 * sets the value itself, or nothing in MusicXML says which member to pick. An
 * unpaired enum not listed here fails.
 */
const NOT_RESTATED: Readonly<Record<string, string>> = {
  MNXTieTargetType: `The model states a tie's crossVoice as a boolean, and the writer spells the one member it can produce from that. A tie into an arpeggio or across a jump is not read.`,
  MNXFermataDuration: `MusicXML's <fermata> states a shape and a side, and says nothing about how long the pause holds, so there is nothing to read.`,
  MNXStaffLabelref:
    "The writer picks which of a part's names its staff draws, from the names the part has. No source value decides it.",
  'MNXImmediateDynamic.type': DYNAMIC_TAG,
  'MNXGradualDynamic.type': DYNAMIC_TAG,
  'MNXAccentDynamic.type': DYNAMIC_TAG,
  'MNXRelativeDynamic.type': RELATIVE_NOT_CONVERTED,
  MNXRelativeDynamicValue: RELATIVE_NOT_CONVERTED,
  'MNXEvent.type': SEQUENCE_ITEM_TAG,
  'MNXSpace.type': SEQUENCE_ITEM_TAG,
  'MNXTuplet.type': SEQUENCE_ITEM_TAG,
  'MNXGraceGroup.type': SEQUENCE_ITEM_TAG,
  'MNXMultiNoteTremolo.type': SEQUENCE_ITEM_TAG,
  'MNXLayoutStaff.type': GROUPING_ITEM_TAG,
  'MNXStaffGroup.type': GROUPING_ITEM_TAG,
}

describe("the model's enums against the MNX ones they are spelled from", () => {
  test('every enum the model states is paired with an MNX one, or says why not', () => {
    expect(
      [...modelUnions.keys()].filter(
        (name) => !(name in MNX_SPELLING) && !(name in NOT_AN_MNX_ENUM),
      ),
    ).toEqual([])
  })

  test('every enum MNX states is reached by a pairing, or says why not', () => {
    // An MNX enum no pairing reaches is output the converter never produces.
    // The schema check sees only what is emitted, and the loss report is
    // driven by the input.
    const paired = new Set(Object.values(MNX_SPELLING))
    expect(
      [...mnxUnions.keys()].filter((name) => !paired.has(name) && !(name in NOT_RESTATED)),
    ).toEqual([])
  })

  test('every pairing names an enum the model still states', () => {
    const paired = [
      ...Object.keys(MNX_SPELLING),
      ...Object.keys(NOT_AN_MNX_ENUM),
      ...Object.keys(NARROWER),
    ]
    expect(paired.filter((name) => !modelUnions.has(name))).toEqual([])
  })

  test('every reason names an enum MNX still states and no pairing reaches', () => {
    const paired = new Set(Object.values(MNX_SPELLING))
    expect(Object.keys(NOT_RESTATED).filter((name) => !mnxUnions.has(name))).toEqual([])
    // A reason beside a pairing would state one decision twice.
    expect(Object.keys(NOT_RESTATED).filter((name) => paired.has(name))).toEqual([])
  })

  test('every stated difference belongs to a pairing', () => {
    expect(Object.keys(NARROWER).filter((name) => !(name in MNX_SPELLING))).toEqual([])
  })

  test.each(Object.entries(MNX_SPELLING))('%s states the same values as %s', (model, mnx) => {
    const stated = modelUnions.get(model) ?? []
    const spelled = mnxUnions.get(mnx)
    expect(spelled, `the MNX types state no ${mnx}`).toBeDefined()
    const deliberate = NARROWER[model]?.missing ?? []

    // Values MNX states and the model does not.
    expect(
      (spelled ?? []).filter((one) => !stated.includes(one) && !deliberate.includes(one)),
    ).toEqual([])
    // Values the model states and MNX does not. The compiler catches these in
    // the writer too; this names the enum rather than the field.
    expect(stated.filter((one) => !(spelled ?? []).includes(one))).toEqual([])
    // A stated difference MNX has dropped, or that the model has since gained.
    expect(
      deliberate.filter((one) => !(spelled ?? []).includes(one) || stated.includes(one)),
    ).toEqual([])
  })
})
