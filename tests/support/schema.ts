// The conformance oracle: the vendored MNX schema, pinned to a specific
// w3c-cg/mnx commit (see schema/PROVENANCE.md). Every document the converter
// produces in a test is checked against it. Shape assertions alone would
// happily pass on output no MNX reader would accept.

import { readFileSync } from 'node:fs'
import type { AnySchema } from 'ajv'
import { compileValidator } from '../../cli/validate.js'

/** A schema node, as far as the conformance test reads one. */
export interface SchemaNode {
  $ref?: string
  allOf?: readonly SchemaNode[]
  properties?: Record<string, SchemaNode>
  patternProperties?: Record<string, SchemaNode>
  items?: SchemaNode
  required?: readonly string[]
  enum?: readonly (string | number)[]
  const?: string | number
  pattern?: string
  type?: string
  minimum?: number
  maximum?: number
}

const parsed = JSON.parse(
  readFileSync(new URL('../../schema/mnx-schema.json', import.meta.url), 'utf8'),
) as { $defs: Record<string, SchemaNode> }

const schema = parsed as AnySchema

/**
 * The schema's definitions, for the conformance test. This module is the only
 * place that reads the schema file, so a test comparing the converter's beliefs
 * against it reads the same bytes the validator does.
 */
export const schemaDefs: Readonly<Record<string, SchemaNode>> = parsed.$defs

/** Follows $ref chains to the node they name. */
export function resolveRef(node: SchemaNode | undefined): SchemaNode | undefined {
  let found = node
  // A chain longer than this is a cycle, and the schema has none.
  for (let step = 0; found?.$ref !== undefined && step < 10; step += 1) {
    found = schemaDefs[found.$ref.replace('#/$defs/', '')]
  }
  return found
}

let validator: ((document: unknown) => string[]) | undefined

/**
 * Empty when the document conforms; otherwise one readable line per error.
 * Compiled on first use, so a validator that fails to compile fails a test
 * rather than the import of every test file.
 */
export function schemaErrors(document: unknown): string[] {
  validator ??= compileValidator(schema)
  return validator(document)
}
