// The generator for the performance tests.

import { describe, expect, test } from 'vitest'
import { convertValid } from './support/convert.js'
import { generateScore } from './support/generate.js'

describe('generated scores', () => {
  for (const notesPerMeasure of [4, 8, 16] as const) {
    test(`convert losslessly to legal MNX at ${notesPerMeasure} notes per measure`, () => {
      const source = generateScore({ parts: 2, measures: 5, notesPerMeasure })
      const { mnx, warnings } = convertValid(source)

      expect(warnings).toEqual([])
      expect(mnx.parts).toHaveLength(2)
      expect(mnx.parts[0]?.measures).toHaveLength(5)

      // A chord note joins the event of the note it follows, so the measure
      // holds notesPerMeasure events, and every fourth one carries two notes.
      const firstMeasure = mnx.parts[0]?.measures?.[0]

      // Each measure has a hairpin with its wording at the closing edge. This
      // puts span pairing and pending wording on the measured path.
      expect(firstMeasure?.dynamics).toHaveLength(1)
      expect(firstMeasure?.dynamics?.[0]).toMatchObject({ type: 'gradual', suffix: 'cresc.' })

      const events = firstMeasure?.sequences?.[0]?.content ?? []
      expect(events).toHaveLength(notesPerMeasure)
      events.forEach((event, index) => {
        const notes = 'notes' in event ? (event.notes ?? []) : []
        expect(notes).toHaveLength(index % 4 === 0 ? 2 : 1)
      })
    })
  }
})
