// The vendored MNX schema, pinned to a w3c-cg/mnx commit (see
// schema/PROVENANCE.md). Every document the converter produces in a test is
// checked against it.

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
 * The schema's definitions. This module is the only place that reads the
 * schema file, so the conformance test and the validator read the same bytes.
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
 * Empty when the document conforms. Otherwise one line per error. Compiled on
 * first use, so a compile failure fails a test, not the import of every test
 * file.
 */
export function schemaErrors(document: unknown): string[] {
  validator ??= compileValidator(schema)
  return validator(document)
}
