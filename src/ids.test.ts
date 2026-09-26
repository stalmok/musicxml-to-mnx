import { expect, test } from 'vitest'
import { GENERATED_ID_PATTERN, renamedId } from './ids.js'

// A renamed id that matched the pattern would be renamed again, or clash
// with an event, note or measure of the same id.
test.each(['part', 'instrument'] as const)(
  'never gives a %s an id the converter generates',
  (kind) => {
    for (let n = 1; n <= 100; n++) {
      expect(GENERATED_ID_PATTERN.test(renamedId(kind, n))).toBe(false)
    }
  },
)
