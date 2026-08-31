// Holds what the converter believes about MNX to what the vendored schema
// says.
//
// The schema is the oracle for the output, and tests/support/schema.ts checks
// every emitted document against it. That reaches nothing the converter
// believes about MNX before it emits anything, and three places state such
// beliefs by hand:
//
//   src/types/mnx.ts             these are MNX's fields and enums
//   src/read/unrepresentable.ts  these elements have nowhere to go in MNX
//   src/read/score.ts            an MNX id looks like this
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
