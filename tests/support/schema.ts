// The conformance oracle: the vendored MNX schema, pinned to a specific
// w3c/mnx commit (see schema/PROVENANCE.md). Every document the converter
// produces in a test is checked against it. Shape assertions alone would
// happily pass on output no MNX reader would accept.

import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'

const schema = JSON.parse(
  readFileSync(new URL('../../schema/mnx-schema.json', import.meta.url), 'utf8'),
) as AnySchema

// strict:false because the schema uses draft-2020 keywords (unevaluatedProperties,
// $defs) that Ajv's strict mode flags as unknown in places; the schema is
// upstream's and is not ours to rewrite.
const validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema)

/** Empty when the document conforms; otherwise one readable line per error. */
export function schemaErrors(document: unknown): string[] {
  if (validator(document)) return []
  return (validator.errors ?? []).map(
    (error) => `${error.instancePath || '<root>'}: ${error.message ?? 'invalid'}`,
  )
}
