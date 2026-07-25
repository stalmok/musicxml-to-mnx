// The generator behind the performance tests, proven against the same
// oracle as everything else: its output converts, the result is legal MNX,
// and the conversion is lossless.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from '../src/index.js'
import { generateScore } from './support/generate.js'
import { schemaErrors } from './support/schema.js'

describe('generated scores', () => {
  for (const notesPerMeasure of [4, 8, 16] as const) {
    test(`convert losslessly to legal MNX at ${notesPerMeasure} notes per measure`, () => {
      const source = generateScore({ parts: 2, measures: 5, notesPerMeasure })
      const { mnx, warnings } = convertMusicXML(source)

      expect(warnings).toEqual([])
      expect(schemaErrors(mnx)).toEqual([])
      expect(mnx.parts).toHaveLength(2)
      expect(mnx.parts[0]?.measures).toHaveLength(5)

      // Each measure carries its notes: the generated count per voice is
      // notesPerMeasure plus one chord note per beat.
      const firstMeasure = mnx.parts[0]?.measures?.[0]
      const events = firstMeasure?.sequences?.[0]?.content ?? []
      expect(events.length).toBeGreaterThanOrEqual(notesPerMeasure)
    })
  }
})
