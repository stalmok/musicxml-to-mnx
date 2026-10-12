// Settling a part's measure repeat signs once the whole part is read.

import type { MeasureRepeatReading } from './attributes.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { PartCollector, PartMeasure } from './partCollector.js'

/**
 * The measure repeat edges of a part. Once the part is read, each sign is
 * walked from its start to its stop, or to the end of the part where the
 * source never closes it, as MusicXML allows. Every measure under the sign
 * draws it in MusicXML; MNX states it only on the first measure of each
 * pattern, so a two-measure pattern is marked on every other measure.
 *
 * MusicXML scopes each edge to a staff, and MNX states one sign for the
 * part's measure, so staves that truly disagree cannot all be carried: the
 * part's sign ends at the first stop and restarts at any start. An edge
 * that cuts or overrides another staff's running sign is reported.
 */
export class MeasureRepeats implements PartCollector {
  readonly #partId: string
  // The edges of each measure stating any, keyed by its index in the part.
  readonly #edges = new Map<number, readonly MeasureRepeatReading[]>()

  constructor(partId: string) {
    this.#partId = partId
  }

  add(at: number, edges: readonly MeasureRepeatReading[]): void {
    if (edges.length > 0) this.#edges.set(at, edges)
  }

  finish(measures: readonly PartMeasure[], warnings: WarningCollector): void {
    // The pattern each staff's sign states, keyed by staff. An edge written
    // without a staff was read as one edge per staff, so the keys are always
    // concrete.
    const open = new Map<number, number>()
    let pattern: number | undefined
    let offset = 0
    measures.forEach((reading, index) => {
      const context: ReportContext = { part: this.#partId, measure: index + 1 }
      const edges = this.#edges.get(index) ?? []
      const stops = edges.filter((edge) => edge.edge === 'stop')
      const starts = edges.filter(
        (edge): edge is Extract<MeasureRepeatReading, { edge: 'start' }> => edge.edge === 'start',
      )

      // A stop is read before a start, so a measure stopping one sign may
      // start the next. A stop for a staff drawing no sign closes nothing, and
      // leaves the staves that are drawing one alone.
      const closed = stops.filter((stop) => open.delete(stop.staff))
      const firstClosed = closed[0]
      if (firstClosed !== undefined) {
        if (open.size > 0) {
          warnings.add(
            'unrepresentable:measure-repeat',
            "This measure stops a measure repeat sign for one staff while another staff's " +
              'sign runs on, and MNX states one sign for the part. The sign ends here for ' +
              'every staff.',
            context,
            firstClosed.element,
          )
          open.clear()
        }
        pattern = undefined
      }

      const first = starts[0]
      if (first !== undefined) {
        // A restated length, as one written per staff, loses nothing;
        // differing lengths cannot all be carried, so the first is kept and
        // the disagreement reported.
        const differing = starts.find((start) => start.measures !== first.measures)
        if (differing !== undefined) {
          warnings.add(
            'unrepresentable:measure-repeat',
            'This measure starts measure repeats of different patterns, and MNX states ' +
              'one for the measure. The first is the one converted.',
            context,
            differing.element,
          )
        }

        // A staff's running sign that no start here restates is cut by the
        // restart, which MusicXML never said happens on that staff.
        const restated = new Set(starts.map((start) => start.staff))
        const cut = [...open.keys()].filter((staff) => !restated.has(staff))
        if (cut.length > 0) {
          warnings.add(
            'unrepresentable:measure-repeat',
            "This measure starts a measure repeat sign while another staff's sign is " +
              'still running, and MNX states one sign for the part. The new sign ' +
              'replaces the running one.',
            context,
            first.element,
          )
          for (const staff of cut) open.delete(staff)
        }

        for (const start of starts) open.set(start.staff, start.measures)
        pattern = first.measures
        offset = 0
      }

      if (pattern !== undefined) {
        if (offset % pattern === 0) reading.measure.measureRepeat = pattern
        offset += 1
      }
    })
  }
}
