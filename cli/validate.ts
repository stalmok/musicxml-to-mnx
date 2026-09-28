// The schema check that the command's --validate and the test suite share.

import { validate } from 'virtual:mnx-validator'

/** One readable line per error, and nothing when the document conforms. */
export function schemaErrors(document: unknown): string[] {
  if (validate(document)) return []
  /* v8 ignore next 3 -- the ?? fallbacks guard Ajv edge cases (no errors
     array, an error with no message) a validation failure does not produce;
     the mapping itself is exercised by the broken-document test. */
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '<root>'}: ${error.message ?? 'invalid'}`,
  )
}
