// Dynamic wording: text such as "cresc." or "poco" written beside a dynamic
// mark. MNX states it only as the prefix or suffix of a mark.

import { reportAt } from './collector.js'
import type { WarningCollector, WrittenAt } from './collector.js'

/** Dynamic wording, and where it is written so a report can point at it. */
export interface Wording {
  text: string
  where: WrittenAt
}

/**
 * Reports wording that qualifies no mark. MNX states wording only as the
 * prefix or suffix of a dynamic mark, and each kind of mark requires more
 * than its wording.
 */
export function reportLoneWording(wording: Wording, warnings: WarningCollector): void {
  reportAt(
    wording.where,
    'unrepresentable:dynamic-wording',
    `The dynamic wording "${wording.text}" qualifies no mark, and MNX states wording ` +
      'only on a mark, so it is not converted.',
    warnings,
  )
}
