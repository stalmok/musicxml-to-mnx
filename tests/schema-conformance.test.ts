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

import { describe, expect, test } from 'vitest'
import { MNX_ID_PATTERN } from '../src/read/score.js'
import { schemaDefs } from './support/schema.js'

describe('the id pattern the reader renames parts by', () => {
  test('matches the schema it was copied from', () => {
    // src/read/score.ts holds a copy rather than reading the schema, because
    // the schema and ajv are dev-only and a conversion must not need either.
    // This is what keeps the copy honest.
    expect(MNX_ID_PATTERN.source).toBe(schemaDefs['id']?.pattern)
  })
})
