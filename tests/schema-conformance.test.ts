// Holds what the converter believes about MNX to what the vendored schema
// says.
//
// The schema is the oracle for the output, and tests/support/schema.ts checks
// every emitted document against it. That reaches nothing the converter
// believes about MNX before it emits anything, and four places state such
// beliefs by hand:
//
//   src/types/mnx.ts             these are MNX's fields and enums
//   src/read/unrepresentable.ts  these elements have nowhere to go in MNX
//   src/read/score.ts            an MNX id looks like this
//   src/model/score.ts           the model's enums, spelled the way MNX does
//
// Both ways of being wrong are silent. A field the types lack cannot be
// emitted, and the output stays legal because the field is optional, so no
// test fails. A registry entry naming something the schema has since gained
// goes on reporting a permanent format limit forever. Neither reaches the loss
// report, which is driven by the input: it knows what MusicXML it did not
// read, and has no notion of an MNX slot it never fills.
//
// Run this after moving the schema pin. It is what makes "update the types to
// match" a step that fails when it is skipped.

import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { MNX_ID_PATTERN } from '../src/read/score.js'
import { NO_HOME_ATTRIBUTES, NO_HOME_IN_MNX } from '../src/read/unrepresentable.js'
import { resolveRef, schemaDefs } from './support/schema.js'
import type { SchemaNode } from './support/schema.js'

describe('the id pattern the reader renames parts by', () => {
  test('matches the schema it was copied from', () => {
    // src/read/score.ts holds a copy rather than reading the schema, because
    // the schema and ajv are dev-only and a conversion must not need either.
    // This is what keeps the copy honest.
    expect(MNX_ID_PATTERN.source).toBe(schemaDefs['id']?.pattern)
  })
})

// --- The MNX types against the schema ---------------------------------------

/**
 * Every exported MNX* interface, with the properties it declares, whether each
 * is optional, and the members of any string-literal union. Inherited
 * properties come with it, so MNXStrongAccent carries MNXMarking's orient.
 *
 * Read through the compiler rather than by parsing text, because the types use
 * `extends` and named aliases, and both have to be resolved to compare
 * anything. TypeScript is already a devDependency, so this costs no new
 * package.
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
      const literals = stated.filter((part) => part.isStringLiteral())
      properties.set(property.getName(), {
        optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
        union:
          literals.length === stated.length && literals.length > 0
            ? literals.map((l) => l.value).sort()
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
  MNXDynamic: 'dynamic-group',
  MNXGlobalMeasure: 'measure-global',
  MNXGraceGroup: 'grace',
  MNXLayoutStaff: 'staff',
  MNXLyricLine: 'event-lyric-line',
  MNXSingleNoteTremolo: 'tremolo-single',
  // A shared base for the marking types rather than a definition of its own.
  // The schema spells each mark out (accent, staccato, ...), and every one of
  // them is a bare orient, which MNXEventMarkings' properties already reach.
  MNXMarking: undefined,
}

/**
 * The three properties $defs/global-attrs gives nearly every object. They are
 * checked once, below, and left out of the per-type comparison: id is written
 * only where something points at a node, and neither _c nor _x is modelled at
 * all. Listing that per type would bury the real differences under sixty
 * repetitions of the same decision.
 */
const GLOBAL_ATTRIBUTES = ['id', '_c', '_x']

/**
 * Schema properties the types deliberately do not model, with the reason.
 * Every entry is a thing the writer cannot currently produce. An entry here is
 * a decision; a difference not here is a drift, and fails.
 */
const NOT_MODELLED: Readonly<Record<string, { properties: readonly string[]; why: string }>> = {
  MNXNote: {
    properties: ['perform', 'staff', 'written'],
    why: 'Playback, the per-note staff a cross-staff chord needs, and a written pitch differing from the sounding one.',
  },
  MNXEvent: {
    properties: ['kitNotes', 'orient', 'type'],
    why: 'Percussion kit notes, the side an event is drawn on, and the "event" discriminant the writer omits.',
  },
  MNXSlur: {
    properties: ['endNote', 'startNote'],
    why: 'A slur pinned to particular notes of the two chords it joins.',
  },
  MNXEventMarkings: { properties: ['bowDirection'], why: 'Up-bow and down-bow are not converted.' },
  MNXTuplet: {
    properties: ['staff'],
    why: 'A tuplet drawn on a staff other than the one its voice sits on.',
  },
  MNXGraceGroup: {
    properties: ['color', 'graceType'],
    why: 'Whether a grace group steals time, and the colour it is drawn in.',
  },
  MNXMultiNoteTremolo: {
    properties: ['individualDuration'],
    why: 'The value each note of the pair is played at, as against the value they are written with.',
  },
  MNXSequence: { properties: ['orient'], why: 'The side a whole voice is drawn on.' },
  MNXClef: {
    properties: ['color', 'glyph'],
    why: 'A specific glyph, and the colour it is drawn in.',
  },
  MNXDynamic: {
    properties: ['relativeValue', 'staffEnd', 'visuallyContinues', 'voice'],
    why: 'Relative dynamics, a hairpin ending on another staff, a continued hairpin, and the voice a mark belongs to.',
  },
  MNXOttava: { properties: ['voice'], why: 'The voice an octave shift applies to.' },
  MNXMeasureRepeat: {
    properties: ['counter', 'displayNumber', 'staffPosition'],
    why: 'How a simile sign is drawn and counted.',
  },
  MNXPart: {
    properties: ['kit', 'transposition'],
    why: 'A percussion kit, and the interval a transposing instrument sounds at.',
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

/** The values a property may hold, where the schema enumerates them. */
function schemaUnion(definition: SchemaNode, property: string): string[] | null {
  const resolved = resolveRef(definition.properties?.[property])
  if (resolved?.enum !== undefined) {
    return resolved.enum.filter((value) => typeof value === 'string').sort()
  }
  if (typeof resolved?.const === 'string') return [resolved.const]
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
    // If MNX adds a fourth, the per-type comparison starts reporting it
    // everywhere, and this says why before that happens.
    expect(Object.keys(schemaDefs['global-attrs']?.properties ?? {}).sort()).toEqual(
      [...GLOBAL_ATTRIBUTES].sort(),
    )
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

    // Schema properties the types lack. Anything not allowlisted is drift, and
    // it is invisible without this: an unmodelled optional field just never
    // gets written, and the output stays legal.
    expect(
      stated.filter((one) => !modelled.includes(one) && !allowed.includes(one)).sort(),
    ).toEqual([])
    // Types the schema has no room for. The schema gate catches these once
    // something emits them; this catches them on the day they are declared.
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
      // Wider than the schema means the types permit output no MNX reader
      // accepts. Narrower means a legal document a consumer cannot describe.
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
 * A MusicXML name is hyphenated and an MNX one is camelCase, so dropping
 * everything but letters and digits lets key-octave meet keyOctave.
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
 * The definitions allowed to carry an element name that the schema does use.
 * An entry here says the name collides but the meaning does not, so it stays
 * on the no-home list. Anything else on that list must be a name the schema
 * does not use at all.
 */
const ELEMENT_COLLISIONS: Readonly<Record<string, readonly string[]>> = {
  // MusicXML's <bracket> is a line drawn over a passage. The schema's brackets
  // are a staff symbol and the one a tuplet is drawn with, and neither spans a
  // passage.
  bracket: ['staff-symbol', 'tuplet'],
  // MusicXML's <system-layout> is page spacing. MNX's system-layout is the
  // arrangement of staves in a system. The names meet; the meanings do not.
  'system-layout': ['system-layout'],
}

/**
 * Where each attribute on the no-home list would live if it had a home, so the
 * fact is that this definition has no such property. The few whose comment
 * makes a claim about the whole schema instead are listed after it.
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
  'tied line-type': 'tie',
  'metronome parentheses': 'tempo',
  'direction system': 'system',
  'measure implicit': 'measure-global',
}

/** Attributes whose comment claims the schema has no such concept anywhere. */
const ATTRIBUTES_NOWHERE: Readonly<Record<string, readonly string[]>> = {
  // No cue and no size concept anywhere.
  'type size': ['size', 'cue'],
  // The same fact the <pedal> element rests on.
  'sound damper-pedal': ['pedal'],
  'sound soft-pedal': ['pedal'],
  'sound sostenuto-pedal': ['pedal'],
}

/** Attributes whose home would be a wider jump-type, not a property. */
const ATTRIBUTES_NEEDING_A_JUMP = ['sound dacapo', 'sound tocoda', 'sound coda']

describe('the registry of what MNX cannot hold, against the schema', () => {
  test.each([...NO_HOME_IN_MNX])('the schema has nowhere for <%s>', (element) => {
    // The bar the registry sets itself: no definition in the schema could hold
    // it. A name the schema has gained is a converter gap, not a format limit,
    // and calling it permanent is the worse of the two errors.
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
    // da capo, a to-coda and a coda have nowhere to go.
    expect(schemaDefs['jump-type']?.enum).toEqual(['dsalfine', 'segno'])
  })
})

// --- The model's enums against the MNX ones they are spelled from -----------
//
// The model is MNX-spelled on purpose (docs/architecture.md): its enums use
// MNX's words so the writer needs no second table. That makes each of them a
// copy, and this is what compares the two.
//
// One direction is already checked: the writer assigns a model value into an
// MNX field, so a model enum gaining a member MNX lacks does not compile. The
// other direction reaches nothing. MNX gaining a member the model lacks is a
// value the converter can never produce, and every document it writes stays
// legal, so no test fails and the loss report says nothing, because the loss
// is at the output end and the report is driven by the input.

/**
 * Each model enum, against the MNX type it is spelled from. An MNX type
 * stated inline on an interface is named Interface.property.
 */
const MNX_SPELLING: Readonly<Record<string, string>> = {
  Step: 'MNXStep',
  NoteValueBase: 'MNXNoteValueBase',
  ClefSign: 'MNXClefSign',
  CurveSide: 'MNXCurveSide',
  LineType: 'MNXLineType',
  FermataSymbol: 'MNXFermataSymbol',
  TupletDisplay: 'MNXTupletDisplaySetting',
  AccentPrefix: 'MNXDynamic.accentPrefix',
  AccentSuffix: 'MNXDynamic.accentSuffix',
  DynamicValue: 'MNXDynamicValue',
  WedgeType: 'MNXWedgeType',
  OttavaAmount: 'MNXOttavaAmount',
  TimeUnit: 'MNXTimeSignatureUnit',
  BarlineType: 'MNXBarlineType',
  JumpType: 'MNXJumpType',
}

/** A model enum MNX states as something other than a value, with what it is. */
const NOT_AN_MNX_ENUM: Readonly<Record<string, string>> = {
  MarkingKind: 'MNX gives each mark a property of its own on event markings.',
}

/**
 * Where the model deliberately states fewer values than MNX, and why. An
 * entry is a decision; a difference not here is drift, and fails.
 */
const NARROWER: Readonly<Record<string, { missing: readonly string[]; why: string }>> = {
  NoteValueBase: {
    missing: ['2048th', '4096th', 'duplexMaxima'],
    why: 'No MusicXML <type> spells any of the three, so the reader cannot produce one.',
  },
}

/**
 * Every exported union of literal values in a file, by name. Read through the
 * compiler for the same reason the interfaces above are: a union states its
 * members through named aliases, and they have to be resolved to compare.
 */
function readUnions(): Map<string, Map<string, string[]>> {
  const files = ['../src/model/score.ts', '../src/types/mnx.ts'].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  )
  const program = ts.createProgram(files, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()

  const found = new Map<string, Map<string, string[]>>()
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (source === undefined) throw new Error(`${file} did not compile.`)
    const unions = new Map<string, string[]>()
    ts.forEachChild(source, (node) => {
      if (!ts.isTypeAliasDeclaration(node)) return
      const symbol = checker.getSymbolAtLocation(node.name)
      if (symbol === undefined) return
      const type = checker.getDeclaredTypeOfSymbol(symbol)
      const parts = type.isUnion() ? type.types : [type]
      const literals = parts.filter((part) => part.isStringLiteral() || part.isNumberLiteral())
      // A union of interfaces, such as SequenceItem, states no values.
      if (literals.length !== parts.length) return
      unions.set(node.name.text, literals.map((literal) => String(literal.value)).sort())
    })
    found.set(file.endsWith('score.ts') ? 'model' : 'mnx', unions)
  }
  return found
}

const unions = readUnions()
const modelUnions = unions.get('model') ?? new Map<string, string[]>()

/** The values an MNX type states, whether it is an alias or an inline union. */
function mnxSpelling(name: string): string[] | undefined {
  const dot = name.indexOf('.')
  if (dot === -1) return unions.get('mnx')?.get(name)
  return mnxTypes.get(name.slice(0, dot))?.get(name.slice(dot + 1))?.union ?? undefined
}

describe("the model's enums against the MNX ones they are spelled from", () => {
  test('every enum the model states is paired with an MNX one, or says why not', () => {
    expect(
      [...modelUnions.keys()].filter(
        (name) => !(name in MNX_SPELLING) && !(name in NOT_AN_MNX_ENUM),
      ),
    ).toEqual([])
  })

  test('every pairing names an enum the model still states', () => {
    const paired = [...Object.keys(MNX_SPELLING), ...Object.keys(NOT_AN_MNX_ENUM)]
    expect(paired.filter((name) => !modelUnions.has(name))).toEqual([])
  })

  test.each(Object.entries(MNX_SPELLING))('%s states the same values as %s', (model, mnx) => {
    const stated = modelUnions.get(model) ?? []
    const spelled = mnxSpelling(mnx)
    expect(spelled, `the MNX types state no ${mnx}`).toBeDefined()
    const deliberate = NARROWER[model]?.missing ?? []

    // Values MNX states and the model does not. Nothing else reports one: it
    // is output the converter can never produce, and what it does produce
    // stays legal.
    expect(
      (spelled ?? []).filter((one) => !stated.includes(one) && !deliberate.includes(one)),
    ).toEqual([])
    // Values the model states and MNX does not. The writer catches these where
    // it assigns one into the other; this names the enum rather than the field.
    expect(stated.filter((one) => !(spelled ?? []).includes(one))).toEqual([])
    // A stated difference MNX has dropped, or that the model has since gained.
    expect(
      deliberate.filter((one) => !(spelled ?? []).includes(one) || stated.includes(one)),
    ).toEqual([])
  })
})
