// Compares what the converter states about MNX by hand with the vendored
// schema. tests/support/schema.ts checks only the emitted documents. These
// places state MNX facts by hand:
//
//   src/types/mnx.ts             these are MNX's fields and enums
//   src/read/unrepresentable.ts  these elements have no home in MNX
//   src/ids.ts                   an MNX id looks like this
//   the reader's numeric limits  MNX counts this far
//   src/warnings.ts              these losses have no home in MNX
//
// Another, the model's enums in src/model/score.ts, copies the types, because
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

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { CLEF_OCTAVES, LONGEST_MNX_REPEAT } from '../src/read/attributes.js'
import { FEWEST_REPEAT_TIMES } from '../src/read/barlines.js'
import { BASE_VALUES } from '../src/read/duration.js'
import { MNX_ID_PATTERN } from '../src/ids.js'
import { TREMOLO_MARKS } from '../src/read/notes.js'
import { MIDI_NUMBERS } from '../src/read/score.js'
import { NO_HOME_ATTRIBUTES, NO_HOME_IN_MNX } from '../src/read/unrepresentable.js'
import type { FormatLimit } from '../src/warnings.js'
import { FOLLOWED_REFERENCES, READ_AT } from './support/references.js'
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

// An ending printed with text other than its numbers is reported as a format
// limit (unrepresentable:ending-text). That rests on the ending holding no
// text.
describe('what an ending holds', () => {
  test('an ending states its numbers and no text', () => {
    expect(Object.keys(schemaDefs['ending']?.properties ?? {}).sort()).toEqual([
      'color',
      'duration',
      'numbers',
      'open',
    ])
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
  MNXGradualDynamic: { properties: ['visuallyContinues', 'voice'], why: DYNAMIC_NOT_MODELLED },
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
    const untyped: string[] = []
    const wider: string[] = []
    const narrower: string[] = []
    for (const [property, { union }] of properties) {
      const stated = schemaUnion(definition, property)
      if (stated === null) continue
      // A plain string or number lets the writer emit any value.
      if (union === null) {
        untyped.push(property)
        continue
      }
      const extra = union.filter((value) => !stated.includes(value))
      const missing = stated.filter((value) => !union.includes(value))
      // A wider type permits output that is not legal MNX. A narrower one
      // cannot describe some legal documents.
      if (extra.length > 0) wider.push(`${property}: ${extra.join(', ')}`)
      if (missing.length > 0) narrower.push(`${property}: ${missing.join(', ')}`)
    }
    expect(untyped).toEqual([])
    expect(wider).toEqual([])
    expect(narrower).toEqual([])
  })
})

// --- The numeric bounds the reader keeps to, against the schema -------------

const BOUND_KINDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
] as const satisfies readonly (keyof SchemaNode)[]

type Bound = Pick<SchemaNode, (typeof BOUND_KINDS)[number]>

/**
 * Every bound the schema puts on a number, keyed by definition, or by
 * definition.property where the property states its own. A bound not listed
 * here fails, and so does one the schema states differently.
 */
const BOUNDS: Readonly<Record<string, Bound>> = {
  'tremolo-single.marks': { minimum: TREMOLO_MARKS.fewest, maximum: TREMOLO_MARKS.most },
  'multi-note-tremolo.marks': { minimum: TREMOLO_MARKS.fewest, maximum: TREMOLO_MARKS.most },
  // The reader refuses a sign that repeats no measures.
  'measure-repeat-count': { minimum: 1, maximum: LONGEST_MNX_REPEAT },
  'repeat-times': { minimum: FEWEST_REPEAT_TIMES },
  'midi-number': { minimum: MIDI_NUMBERS.lowest, maximum: MIDI_NUMBERS.highest },
  // Compared with the model's stroke counts below.
  'caesura.marks': { minimum: 1, maximum: 2 },
  // The reader reports a tempo of zero or less.
  bpm: { exclusiveMinimum: 0 },
  // An ending covers the measure it starts on.
  'ending-duration': { minimum: 1 },
  // The reader reports an ending numbered below 1.
  'ending-number': { minimum: 1 },
  // The reader refuses a multi-measure rest of no measures.
  'measure-count': { minimum: 1 },
  // The reader reports a measure label that is not a whole number.
  'measure-number': { minimum: 0 },
  // The reader refuses a part of no staves, and numbers staves from 1.
  'staff-count': { minimum: 1 },
  'staff-number': { minimum: 1 },
  'integer-unsigned': { minimum: 0 },
  'positive-integer': { minimum: 1 },
}

function boundOf(node: SchemaNode | undefined): Bound | undefined {
  if (node === undefined) return undefined
  const stated = BOUND_KINDS.flatMap((kind) =>
    node[kind] !== undefined ? [[kind, node[kind]] as const] : [],
  )
  return stated.length > 0 ? Object.fromEntries(stated) : undefined
}

/** Every bound the schema states, keyed as BOUNDS is. */
function schemaBounds(): Map<string, Bound> {
  const found = new Map<string, Bound>()
  for (const [name, definition] of Object.entries(schemaDefs)) {
    const own = boundOf(definition)
    if (own) found.set(name, own)
    for (const [property, node] of Object.entries(definition.properties ?? {})) {
      const stated = boundOf(node)
      if (stated) found.set(`${name}.${property}`, stated)
    }
  }
  return found
}

describe('the numeric bounds the reader keeps to, against the schema', () => {
  const stated = schemaBounds()

  test('every bound the schema states is listed', () => {
    expect([...stated.keys()].filter((key) => !(key in BOUNDS)).sort()).toEqual([])
    expect(Object.keys(BOUNDS).filter((key) => !stated.has(key))).toEqual([])
  })

  test.each(Object.entries(BOUNDS))('%s is bounded as the schema bounds it', (key, bound) => {
    expect(bound).toEqual(stated.get(key))
  })

  test('a clef is transposed by the amounts the schema allows', () => {
    // Zero is how MNX states an untransposed clef, which the model leaves
    // undefined.
    expect([...CLEF_OCTAVES, 0].sort()).toEqual(
      [...(schemaDefs['ottava-amount-or-zero']?.enum ?? [])].sort(),
    )
  })

  test('every caesura stroke count the model states is within the bound', () => {
    const { minimum = 1, maximum = 1 } = BOUNDS['caesura.marks'] ?? {}
    const counts = modelUnions.get('CaesuraMarking.marks')?.map(Number) ?? []
    expect(counts.length).toBeGreaterThan(0)
    expect(counts.filter((count) => count < minimum || count > maximum)).toEqual([])
  })
})

// --- The id references the output check follows, against the schema -------

/** Every schema property that names an id, as definition.property. */
function idReferenceProperties(): string[] {
  const names = ['#/$defs/id', '#/$defs/id-pair', '#/$defs/lyric-line-id']
  const found: string[] = []
  for (const [definition, node] of Object.entries(schemaDefs)) {
    // An object's own id defines it, and an id pair is followed where it is
    // used.
    if (definition === 'global-attrs' || definition === 'id-pair') continue
    for (const [property, value] of Object.entries(node.properties ?? {})) {
      if (names.includes(value.$ref ?? value.items?.$ref ?? '')) {
        found.push(`${definition}.${property}`)
      }
    }
  }
  return found.sort()
}

/** Whether an MNX type models a schema property, so the writer can emit it. */
function typesModel(reference: string): boolean {
  const [definition = '', property = ''] = reference.split('.')
  return [...mnxTypes.entries()].some(
    ([name, properties]) =>
      (name in DEFINITION_OF ? DEFINITION_OF[name] : kebab(name)) === definition &&
      properties.has(property),
  )
}

/**
 * The schema properties that hold a definition, as definition.property. A
 * list or map of the definition, such as tie-list, is followed to where it is
 * held in turn.
 */
function placesOf(target: string): string[] {
  const ref = `#/$defs/${target}`
  const found: string[] = []
  for (const [definition, node] of Object.entries(schemaDefs)) {
    const values = Object.values(node.patternProperties ?? {})
    if (node.items?.$ref === ref || values.some((value) => value.$ref === ref)) {
      found.push(...placesOf(definition))
      continue
    }
    for (const [property, value] of Object.entries(node.properties ?? {})) {
      if (value.$ref === ref || value.items?.$ref === ref) found.push(`${definition}.${property}`)
    }
  }
  return found.sort()
}

describe('the id references the output check follows, against the schema', () => {
  const references = idReferenceProperties()
  const followed: readonly string[] = FOLLOWED_REFERENCES
  const holders = [...new Set(followed.map((one) => one.slice(0, one.indexOf('.'))))].sort()

  test('follows every reference the MNX types model', () => {
    expect(references.filter((one) => typesModel(one) && !followed.includes(one))).toEqual([])
  })

  test('follows only references the schema states and the MNX types model', () => {
    expect(followed.filter((one) => !references.includes(one))).toEqual([])
    expect(followed.filter((one) => !typesModel(one))).toEqual([])
  })

  test('says where it reads each definition that holds a reference', () => {
    expect(Object.keys(READ_AT).sort()).toEqual(holders)
  })

  test.each(holders)('reads %s everywhere the MNX types hold one', (holder) => {
    const modelled = placesOf(holder).filter(typesModel)
    expect([...(READ_AT[holder] ?? [])].sort()).toEqual(modelled)
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

/** A name as the schema comparison reads it: lower case, letters and digits. */
function normalised(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Every name the schema uses, normalised, against the definitions that use it.
 * A MusicXML name is hyphenated and an MNX one is camelCase, so only letters
 * and digits are kept: key-octave matches keyOctave.
 */
function schemaNames(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const note = (name: string, where: string): void => {
    const key = normalised(name)
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
  return [...(names.get(normalised(name)) ?? [])].sort()
}

/**
 * The words the schema would use for a concept, and where it would put them.
 * With homes, the concept is looked for in the properties and values of those
 * definitions alone, as part of a name, because the schema uses some of the
 * words elsewhere with another meaning: a clef has hide. Without homes, the
 * concept is looked for everywhere, as a whole name.
 */
interface Concept {
  readonly words: readonly string[]
  readonly homes?: readonly string[]
}

/** The words of a concept the schema uses where it would hold the concept. */
function conceptFound({ words, homes }: Concept): string[] {
  const wanted = words.map(normalised)
  if (homes === undefined) return wanted.filter((word) => usedBy(word).length > 0)
  const held = homes.flatMap((home) => {
    const definition = schemaDefs[home]
    return [
      ...Object.keys(definition?.properties ?? {}),
      ...(definition?.enum ?? []).map((value) => String(value)),
    ].map(normalised)
  })
  return wanted.filter((word) => held.some((name) => name.includes(word)))
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
 * The concept each group of elements on the no-home list stands for. The
 * schema could gain the concept under a name of its own, which the spelling
 * check above does not see.
 */
const ELEMENT_CONCEPTS: readonly (Concept & { readonly elements: readonly string[] })[] = [
  { elements: ['pedal'], words: ['pedal', 'sustain', 'sostenuto', 'unaCorda', 'damper'] },
  {
    elements: ['words'],
    words: ['words', 'text', 'expression', 'directions', 'instruction'],
    homes: ['measure-global', 'part-measure', 'event'],
  },
  {
    elements: ['dashes', 'bracket'],
    words: ['dashes', 'bracket', 'brackets', 'lines', 'extender'],
    homes: ['measure-global', 'part-measure'],
  },
  {
    elements: ['rehearsal'],
    words: ['rehearsal', 'label', 'mark', 'marks'],
    homes: ['measure-global'],
  },
  { elements: ['coda'], words: ['coda', 'toCoda'], homes: ['jump-type', 'measure-global'] },
  {
    elements: ['notehead'],
    words: ['notehead', 'head', 'shape', 'glyph'],
    homes: ['note', 'event', 'kit-note', 'kit-component'],
  },
  { elements: ['cue'], words: ['cue', 'size', 'small'] },
  {
    elements: [
      'trill-mark',
      'turn',
      'inverted-turn',
      'mordent',
      'inverted-mordent',
      'wavy-line',
      'accidental-mark',
    ],
    words: ['ornament', 'ornaments', 'trill', 'turn', 'mordent', 'wavyLine', 'vibrato'],
  },
  { elements: ['slide'], words: ['slide', 'glissando', 'portamento'] },
  {
    elements: [
      'harmonic',
      'open-string',
      'thumb-position',
      'fingering',
      'pluck',
      'double-tongue',
      'triple-tongue',
      'stopped',
      'snap-pizzicato',
      'fret',
      'string',
      'hammer-on',
      'pull-off',
      'bend',
      'tap',
      'heel',
      'toe',
      'fingernails',
      'hole',
      'arrow',
      'handbell',
      'brass-bend',
      'flip',
      'smear',
      'open',
      'half-muted',
      'harmon-mute',
      'golpe',
      'other-technical',
    ],
    words: [
      'technical',
      'technique',
      'fingering',
      'harmonic',
      'pluck',
      'pizzicato',
      'fret',
      'mute',
      'muted',
      'tongue',
      'tonguing',
      'bend',
      'hammerOn',
      'pullOff',
    ],
  },
  {
    elements: ['extend'],
    words: ['extend', 'extender', 'melisma', 'line'],
    homes: ['event-lyric-line'],
  },
  {
    elements: ['mode', 'cancel', 'key-octave'],
    words: ['mode', 'cancel', 'naturals', 'octave'],
    homes: ['key'],
  },
  {
    elements: ['work', 'movement-title', 'movement-number'],
    words: ['work', 'movement', 'title', 'composer', 'opus'],
  },
  {
    elements: ['staff-type', 'line-detail', 'staff-tuning', 'capo', 'staff-size'],
    words: ['ossia', 'cue', 'size', 'scale', 'tuning', 'capo', 'detail', 'details'],
    homes: ['staff-config', 'staff'],
  },
  {
    elements: ['credit'],
    words: ['credit', 'credits', 'text', 'words', 'title'],
    homes: ['score', 'page', 'system', 'system-layout'],
  },
  {
    elements: ['identification'],
    words: ['identification', 'composer', 'rights', 'copyright', 'encoding', 'creator'],
  },
  {
    elements: [
      'defaults',
      'page-layout',
      'system-layout',
      'staff-layout',
      'measure-layout',
      'measure-numbering',
    ],
    words: ['width', 'height', 'margin', 'margins', 'scaling', 'spacing', 'distance', 'numbering'],
    homes: ['score', 'page', 'system', 'system-layout', 'staff', 'layout-change'],
  },
  {
    elements: [
      'instrument-sound',
      'instrument-abbreviation',
      'virtual-instrument',
      'midi-device',
      'midi-channel',
      'midi-bank',
      'midi-program',
      'volume',
      'pan',
      'elevation',
    ],
    words: [
      'program',
      'patch',
      'channel',
      'bank',
      'volume',
      'pan',
      'elevation',
      'device',
      'abbreviation',
      'virtualInstrument',
    ],
    homes: ['sound', 'part', 'kit-component'],
  },
]

/**
 * The words for hiding. The schema states hide for a clef and show for an
 * accidental, and nothing else.
 */
const HIDING = ['hide', 'hidden', 'show', 'visible', 'invisible', 'print-object']

/**
 * The concept behind each attribute on the no-home list. Only a dot's side and
 * a caesura's are spelled as the schema would spell them, so the attribute's
 * own name is not enough to look for.
 */
const ATTRIBUTE_CONCEPTS: Readonly<Record<string, Concept>> = {
  'dot placement': { words: ['placement', 'side', 'position'], homes: ['note-value'] },
  'type size': { words: ['cue', 'size', 'small'] },
  'note dynamics': {
    words: ['dynamics', 'velocity', 'volume'],
    homes: ['note', 'perform-options'],
  },
  'sound dynamics': { words: ['dynamics', 'velocity', 'volume'], homes: ['sound'] },
  // MNX jumps to a segno or plays to a Fine, and names nothing else.
  'sound dacapo': { words: ['daCapo', 'dc', 'start'], homes: ['jump-type', 'jump'] },
  'sound tocoda': { words: ['toCoda', 'coda'], homes: ['jump-type', 'jump'] },
  'sound coda': { words: ['coda'], homes: ['jump-type', 'jump', 'measure-global'] },
  'sound pan': { words: ['pan', 'stereo'], homes: ['sound'] },
  'sound elevation': { words: ['elevation', 'height'], homes: ['sound'] },
  'sound damper-pedal': { words: ['pedal', 'sustain', 'damper'] },
  'sound soft-pedal': { words: ['pedal', 'unaCorda', 'soft'] },
  'sound sostenuto-pedal': { words: ['pedal', 'sostenuto'] },
  'note print-object': { words: HIDING, homes: ['note', 'event'] },
  'notations print-object': {
    words: HIDING,
    // A tuplet's showNumber and showValue hold its hiding, and are converted.
    homes: ['event-markings', 'fermata', 'slur', 'tie', 'arpeggio'],
  },
  'key print-object': { words: HIDING, homes: ['key'] },
  'time print-object': { words: HIDING, homes: ['time'] },
  'ending print-object': { words: HIDING, homes: ['ending'] },
  'lyric print-object': { words: HIDING, homes: ['event-lyric-line', 'lyrics'] },
  'sound pizzicato': { words: ['pizzicato', 'pluck', 'plucked'] },
  'sound segno': { words: ['name', 'label'], homes: ['segno'] },
  // The same fact <staff-tuning>, <capo> and <fret> rest on: no tablature.
  'staff-details show-frets': { words: ['tablature', 'tuning', 'fret', 'frets', 'capo'] },
  'caesura placement': { words: ['placement', 'side'], homes: ['caesura'] },
  'clef after-barline': {
    words: ['afterBarline', 'barline', 'side'],
    homes: ['clef', 'positioned-clef'],
  },
  'tied line-type': { words: ['lineType', 'dashed', 'dotted', 'style'], homes: ['tie'] },
  'metronome parentheses': {
    words: ['parentheses', 'parenthesis', 'enclosure', 'bracket'],
    homes: ['tempo'],
  },
  'direction system': {
    words: ['system', 'systems', 'top'],
    homes: ['tempo', 'segno', 'ottava', 'dynamic-group-immediate', 'dynamic-group-gradual'],
  },
  'measure implicit': {
    words: ['implicit', 'numbered', 'unnumbered', 'pickup', 'anacrusis'],
    homes: ['measure-global'],
  },
  'print page-number': { words: ['number', 'pageNumber'], homes: ['page'] },
  'print blank-page': { words: ['blank', 'empty'], homes: ['page'] },
  'print staff-spacing': {
    words: ['spacing', 'distance'],
    homes: ['system', 'system-layout', 'staff', 'staff-group'],
  },
}

/** Whether an element on the no-home list still has none, by name. */
function elementUnnamed(element: string): boolean {
  return usedBy(element).join() === [...(ELEMENT_COLLISIONS[element] ?? [])].sort().join()
}

describe('the registry of what MNX cannot hold, against the schema', () => {
  test.each([...NO_HOME_IN_MNX])('the schema has nowhere for <%s>', (element) => {
    // No definition in the schema could hold it. A name the schema has gained
    // is a converter gap, not a format limit.
    expect(usedBy(element)).toEqual([...(ELEMENT_COLLISIONS[element] ?? [])].sort())
  })

  test('every collision exception names an element still on the list', () => {
    expect(Object.keys(ELEMENT_COLLISIONS).filter((one) => !NO_HOME_IN_MNX.has(one))).toEqual([])
  })

  test('every element on the list is in exactly one concept group', () => {
    const grouped = ELEMENT_CONCEPTS.flatMap((group) => group.elements)
    expect([...NO_HOME_IN_MNX].filter((one) => !grouped.includes(one))).toEqual([])
    expect(grouped.filter((one) => !NO_HOME_IN_MNX.has(one))).toEqual([])
    expect(grouped.filter((one, index) => grouped.indexOf(one) !== index)).toEqual([])
  })

  test.each(ELEMENT_CONCEPTS.map((group) => [group.elements.join(', '), group] as const))(
    'the schema states no concept behind <%s>',
    (_elements, group) => {
      expect(conceptFound(group)).toEqual([])
    },
  )

  test('every attribute on the list states the concept it stands for', () => {
    expect([...NO_HOME_ATTRIBUTES].filter((one) => !(one in ATTRIBUTE_CONCEPTS))).toEqual([])
    expect(Object.keys(ATTRIBUTE_CONCEPTS).filter((one) => !NO_HOME_ATTRIBUTES.has(one))).toEqual(
      [],
    )
  })

  test.each(Object.entries(ATTRIBUTE_CONCEPTS))(
    'the schema states no concept behind %s',
    (_attribute, concept) => {
      expect(conceptFound(concept)).toEqual([])
    },
  )

  test('every definition a concept is looked for in still exists', () => {
    const homes = [
      ...ELEMENT_CONCEPTS.flatMap((group) => group.homes ?? []),
      ...Object.values(ATTRIBUTE_CONCEPTS).flatMap((concept) => concept.homes ?? []),
    ]
    expect(homes.filter((home) => !(home in schemaDefs))).toEqual([])
  })

  test('a word for hiding is used where the schema states it, and nowhere else', () => {
    // Hiding is looked for only in each attribute's own home, because a clef
    // can hide. This names every other place, so a new one is decided here.
    expect(HIDING.flatMap((word) => usedBy(word))).toEqual(['clef', 'accidental-display'])
  })
})

// --- Each format limit, against the schema fact it rests on -----------------

/**
 * A definition the facts below name. A definition MNX renames or removes
 * throws, so a fact stated as an absence cannot pass because its subject has
 * gone.
 */
function definitionNamed(name: string): SchemaNode {
  const definition = schemaDefs[name]
  if (definition === undefined) throw new Error(`The schema has no definition ${name}.`)
  return definition
}

/** The properties a definition states, without the ones every object gets. */
function propertiesOf(definition: string): string[] {
  return schemaProperties(definitionNamed(definition)).sort()
}

function has(definition: string, property: string): boolean {
  return definitionNamed(definition).properties?.[property] !== undefined
}

function isList(definition: string, property: string): boolean {
  return definitionNamed(definition).properties?.[property]?.type === 'array'
}

function refers(definition: string, property: string, target: string): boolean {
  const held = definitionNamed(definition).properties?.[property]
  return held !== undefined && resolveRef(held) === definitionNamed(target)
}

/** The values a definition enumerates, as sorted text. */
function valuesOf(definition: string): string[] {
  return (definitionNamed(definition).enum ?? []).map(String).sort()
}

/** The definitions an anyOf list holds, by name. */
function itemsOf(definition: string): string[] {
  return (definitionNamed(definition).items?.anyOf ?? [])
    .map((item) => (item.$ref ?? '').replace('#/$defs/', ''))
    .sort()
}

/** Whether the schema holds a definition at the one place named, and nowhere else. */
function heldOnlyAt(definition: string, place: string): boolean {
  definitionNamed(definition)
  return placesOf(definition).join() === place
}

/** The marks MNX states once on a global measure. */
const GLOBAL_MARKS = ['ending', 'fermata', 'fine', 'jump', 'repeatEnd', 'repeatStart', 'segno']

/**
 * The schema fact each format limit rests on, as a test of the schema that
 * holds while the limit does. Keyed by the code, so a new format limit does not
 * compile until it states its fact. A failure means MNX may have gained a home
 * for the loss: move the code to a converter gap, or convert it.
 */
const FORMAT_LIMITS: Readonly<Record<FormatLimit, () => boolean>> = {
  'unrepresentable:element': () =>
    [...NO_HOME_IN_MNX].every(elementUnnamed) &&
    ELEMENT_CONCEPTS.every((group) => conceptFound(group).length === 0),
  'unrepresentable:attribute': () =>
    Object.values(ATTRIBUTE_CONCEPTS).every((concept) => conceptFound(concept).length === 0),
  'unrepresentable:measure-label': () =>
    resolveRef(definitionNamed('measure-global').properties?.['number'])?.type === 'integer' &&
    !has('measure-global', 'label'),
  'unrepresentable:per-staff-key': () => !has('key', 'staff') && !has('part-measure', 'key'),
  'unrepresentable:per-staff-transposition': () =>
    !has('part-transposition', 'staff') && !isList('part', 'transposition'),
  'unrepresentable:transposition-change': () =>
    !has('part-measure', 'transposition') && !has('measure-global', 'transposition'),
  'unrepresentable:per-staff-time': () => !has('time', 'staff') && !has('part-measure', 'time'),
  'unrepresentable:cross-part-key': () =>
    has('measure-global', 'key') && !has('part-measure', 'key'),
  'unrepresentable:cross-part-time': () =>
    has('measure-global', 'time') && !has('part-measure', 'time'),
  'unrepresentable:cross-part-barline': () =>
    has('measure-global', 'barline') && !has('part-measure', 'barline'),
  'unrepresentable:cross-part-segno': () =>
    !isList('measure-global', 'segno') && !has('part-measure', 'segno'),
  // MNX's color states no form, and the one form the schema does state has
  // no alpha.
  'unrepresentable:color': () => {
    const forms = ['color', 'simple-color'].flatMap((name) => schemaDefs[name]?.pattern ?? [])
    return forms.length > 0 && forms.every((form) => !new RegExp(form).test('#ffffffff'))
  },
  'unrepresentable:cross-part-mark': () =>
    GLOBAL_MARKS.every((mark) => has('measure-global', mark) && !has('part-measure', mark)),
  'unrepresentable:repeat-times': () =>
    refers('repeat-end', 'times', 'repeat-times') &&
    schemaDefs['repeat-times']?.minimum === FEWEST_REPEAT_TIMES,
  'unrepresentable:stem-direction': () => valuesOf('stem-direction').join() === 'down,up',
  'unrepresentable:tempo': () =>
    propertiesOf('tempo').join() === 'bpm,location,value' &&
    (schemaDefs['tempo']?.required ?? []).includes('bpm') &&
    schemaDefs['bpm']?.type === 'number' &&
    schemaDefs['bpm']?.exclusiveMinimum === 0 &&
    refers('tempo', 'value', 'note-value'),
  'unrepresentable:lyric-syllabic': () =>
    propertiesOf('event-lyric-line').join() === 'text,type' &&
    refers('event-lyric-line', 'type', 'event-lyric-line-type'),
  'unrepresentable:lyric-line': () =>
    Object.values(definitionNamed('event-lyric-lines').patternProperties ?? {})
      .map((value) => value.$ref)
      .join() === '#/$defs/event-lyric-line',
  'unrepresentable:fermata': () => refers('event', 'fermata', 'fermata'),
  'unrepresentable:marking': () =>
    propertiesOf('event-markings').every((mark) => !isList('event-markings', mark)),
  // A chord is listed as rolled or as struck together, and neither list says
  // anything of the other.
  'unrepresentable:arpeggio': () =>
    propertiesOf('arpeggio').join() === 'arrow,direction,position,span' &&
    propertiesOf('non-arpeggio').join() === 'position,span',
  'unrepresentable:ending-text': () =>
    propertiesOf('ending').join() === 'color,duration,numbers,open',
  'unrepresentable:barline': () =>
    propertiesOf('barline').join() === 'type' && heldOnlyAt('barline', 'measure-global.barline'),
  // Nothing orders two clefs, or two staff configs, at one point.
  'unrepresentable:clef': () => propertiesOf('rhythmic-position').join() === 'fraction,graceIndex',
  'unrepresentable:staff-config': () =>
    propertiesOf('rhythmic-position').join() === 'fraction,graceIndex',
  'unrepresentable:senza-misura': () =>
    (schemaDefs['time']?.required ?? []).includes('count') &&
    usedBy('senzaMisura').length === 0 &&
    usedBy('unmetered').length === 0,
  'unrepresentable:mid-measure-key': () => heldOnlyAt('key', 'measure-global.key'),
  'unrepresentable:mid-measure-time': () => heldOnlyAt('time', 'measure-global.time'),
  'unrepresentable:rest-length': () =>
    !has('full-measure-rest', 'duration') &&
    refers('full-measure-rest', 'visualDuration', 'note-value'),
  'unrepresentable:time-symbol': () => valuesOf('time-signature-display').join() === 'common,cut',
  'unrepresentable:interchangeable-time': () =>
    !isList('measure-global', 'time') && propertiesOf('time').join() === 'count,display,unit',
  'unrepresentable:octave-shift-size': () =>
    refers('ottava', 'value', 'ottava-amount') &&
    valuesOf('ottava-amount').join() === '-1,-2,-3,1,2,3',
  'unrepresentable:clef-octave': () =>
    Math.max(...valuesOf('ottava-amount-or-zero').map((value) => Math.abs(Number(value)))) === 3,
  'unrepresentable:clef-sign': () => valuesOf('clef-sign').join() === 'C,F,G,P',
  'unrepresentable:non-traditional-key': () => propertiesOf('key').join() === 'color,fifths',
  'unrepresentable:group-symbol': () =>
    valuesOf('staff-symbol').join() === 'brace,bracket,noSymbol',
  // A layout is a tree: a group holds staves and other groups.
  'unrepresentable:part-group-overlap': () =>
    refers('staff-group', 'content', 'system-layout-content') &&
    itemsOf('system-layout-content').join() === 'staff,staff-group',
  'unrepresentable:part-id': () => definitionNamed('id').pattern === MNX_ID_PATTERN.source,
  // A kit component names its sound by MNX id, not by the key global.sounds
  // allows.
  'unrepresentable:instrument-id': () => refers('kit-component', 'sound', 'id'),
  'unrepresentable:multimeasure-rest': () =>
    propertiesOf('multimeasure-rest').join() === 'duration,label,start',
  'unrepresentable:cross-part-multimeasure-rest': () =>
    has('score', 'multimeasureRests') &&
    !has('part', 'multimeasureRests') &&
    !has('part-measure', 'multimeasureRest'),
  'unrepresentable:multiple-rest-symbols': () =>
    propertiesOf('multimeasure-rest').join() === 'duration,label,start',
  'unrepresentable:measure-repeat': () =>
    !isList('part-measure', 'measureRepeat') && schemaDefs['measure-repeat-count']?.maximum === 4,
  'unrepresentable:measure-repeat-slashes': () =>
    propertiesOf('measure-repeat').join() === 'counter,displayNumber,number,staffPosition',
  'unrepresentable:grace-time': () =>
    propertiesOf('grace').join() === 'color,content,graceType,slash,type' &&
    valuesOf('grace-type').join() === 'makeTime,stealFollowing,stealPrevious',
  // The rest a sequence states for its whole measure has no length.
  'unrepresentable:grace-beside-rest': () =>
    refers('sequence', 'fullMeasure', 'full-measure-rest') && !has('full-measure-rest', 'duration'),
  // A dynamic's wording is text; only the mark itself takes glyphs.
  'unrepresentable:wording-glyph': () =>
    itemsOf('dynamic-groups').every((group) =>
      propertiesOf(group)
        .filter((property) => /glyph/i.test(property))
        .every((property) => property === 'glyphs'),
    ),
  // Every kind of dynamic states a mark, a hairpin or a change, beside any
  // wording.
  'unrepresentable:dynamic-wording': () =>
    itemsOf('dynamic-groups').every(
      (group) =>
        (schemaDefs[group]?.required ?? []).filter(
          (property) => !['end', 'position', 'type'].includes(property),
        ).length > 0,
    ),
  // A tuplet holds what it brackets, so tuplets nest and do not cross.
  'unrepresentable:tuplet-crossing': () => refers('tuplet', 'content', 'sequence-content'),
  'unrepresentable:tuplet-span': () =>
    refers('tuplet', 'content', 'sequence-content') &&
    itemsOf('sequence-content').includes('tuplet') &&
    !has('tuplet', 'end'),
  'unrepresentable:tuplet-ratio': () =>
    [...(schemaDefs['note-value-quantity']?.required ?? [])].sort().join() ===
      'duration,multiple' && refers('note-value-quantity', 'multiple', 'positive-integer'),
  // A tuplet states a written length against the time it is played in, each
  // at least one note value long.
  'unrepresentable:tuplet-untimed': () =>
    ['inner', 'outer'].every(
      (side) =>
        (definitionNamed('tuplet').required ?? []).includes(side) &&
        refers('tuplet', side, 'note-value-quantity'),
    ) && schemaDefs['positive-integer']?.minimum === 1,
  'unrepresentable:print-detail': () =>
    propertiesOf('page').join() === 'layout,systems' &&
    propertiesOf('system').join() === 'layout,layoutChanges,measure',
  'unrepresentable:microtone': () => schemaDefs['alter']?.type === 'integer',
}

/**
 * The places that raise the element or attribute code with a message of their
 * own, rather than through the registry, by file, with the schema fact each
 * rests on. A new call site fails until it is listed.
 */
const CALL_SITE_LIMITS: Readonly<
  Record<string, readonly { readonly says: string; readonly holds: () => boolean }[]>
> = {
  'src/read/directions.ts': [
    {
      says: 'a segno or a tempo states no side',
      holds: () => !has('segno', 'placement') && !has('tempo', 'placement'),
    },
  ],
  'src/read/notes.ts': [
    {
      says: 'a kit note strikes one component',
      holds: () => propertiesOf('kit-note').every((property) => !isList('kit-note', property)),
    },
    {
      says: 'neither a measure rest nor a space carries a mark',
      holds: () =>
        propertiesOf('full-measure-rest').join() === 'fermata,staffPosition,visualDuration' &&
        propertiesOf('space').join() === 'duration,type',
    },
    {
      says: 'a tremolo is a count of beams',
      holds: () =>
        propertiesOf('tremolo-single').join() === 'marks,placement' &&
        (schemaDefs['tremolo-single']?.required ?? []).includes('marks'),
    },
    {
      says: 'a single-note tremolo counts from one beam',
      holds: () => schemaDefs['tremolo-single']?.properties?.['marks']?.minimum === 1,
    },
    {
      says: 'a two-note tremolo states no side',
      holds: () => !has('multi-note-tremolo', 'placement'),
    },
    {
      says: 'a two-note tremolo counts one to eight beams',
      holds: () => schemaDefs['multi-note-tremolo']?.properties?.['marks']?.maximum === 8,
    },
  ],
  'src/read/score.ts': [
    {
      says: 'a measure states one of each mark',
      holds: () => GLOBAL_MARKS.every((mark) => !isList('measure-global', mark)),
    },
  ],
  'src/read/spanners.ts': [
    {
      says: 'a tie is always drawn',
      holds: () => propertiesOf('tie').join() === 'lv,side,target,targetType',
    },
  ],
}

/**
 * How many times each source file under src names the element or attribute
 * code. The registry's own module and the list of codes are left out.
 */
function callSites(): Map<string, number> {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const skipped = ['src/read/unrepresentable.ts', 'src/warnings.ts']
  const found = new Map<string, number>()
  for (const entry of readdirSync(`${root}src`, { recursive: true, encoding: 'utf8' })) {
    const file = `src/${entry}`
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || skipped.includes(file)) continue
    const text = readFileSync(`${root}${file}`, 'utf8')
    const count = (text.match(/unrepresentable:(element|attribute)\b/g) ?? []).length
    if (count > 0) found.set(file, count)
  }
  return found
}

describe('each format limit, against the schema fact it rests on', () => {
  test.each(Object.entries(FORMAT_LIMITS))('%s still has no home in MNX', (_code, holds) => {
    expect(holds()).toBe(true)
  })

  test('every call site raising the element or attribute code states its fact', () => {
    const listed = Object.entries(CALL_SITE_LIMITS).map(([file, facts]) => [file, facts.length])
    expect([...callSites().entries()].sort()).toEqual(listed.sort())
  })

  test.each(
    Object.values(CALL_SITE_LIMITS)
      .flat()
      .map((fact) => [fact.says, fact] as const),
  )('%s', (_says, { holds }) => {
    expect(holds()).toBe(true)
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
