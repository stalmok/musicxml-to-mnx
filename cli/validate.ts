// The schema check that the command's --validate and the test suite share.

import Ajv2020 from 'ajv/dist/2020.js'
import type { AnySchema } from 'ajv'

/**
 * Compiles the MNX schema into a check that returns one readable line per
 * error, and nothing when the document conforms.
 */
export function compileValidator(schema: AnySchema): (document: unknown) => string[] {
  // strict:false because Ajv's strictTypes rejects the upstream schema's
  // keyword placement (a "maximum" with no "type"). allErrors reports every
  // problem, not only the first.
  const validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema)

  return (document) => {
    if (validator(document)) return []
    /* v8 ignore next 3 -- the ?? fallbacks guard Ajv edge cases (no errors
       array, an error with no message) a validation failure does not produce;
       the mapping itself is exercised by the broken-document test. */
    return (validator.errors ?? []).map(
      (error) => `${error.instancePath || '<root>'}: ${error.message ?? 'invalid'}`,
    )
  }
}
