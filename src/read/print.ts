// A <print> says how the score is laid out from its measure on. The system
// and page breaks are notation MNX states as the score rendering's pages and
// systems; most of the rest of the element is spacing and numbering with no
// home there.

import type { WarningContext } from '../warnings.js'
import type { WarningCollector } from './collector.js'
import { attribute } from '../xml/tree.js'
import type { ElementReader } from './element.js'

export interface PrintReading {
  systemBreak: boolean
  pageBreak: boolean
}

// The attributes a <print> may carry besides the two breaks. Reported here
// as having no home in MNX; the sweep would report them as a converter gap.
const UNCARRIED_PRINT_ATTRIBUTES = ['page-number', 'blank-page', 'staff-spacing'] as const

/**
 * The breaks a <print> states. Its children (system and page layout, measure
 * numbering, the part name drawn from here on) are left to the unread-child
 * sweep, which reports each by name.
 */
export function readPrint(
  element: ElementReader,
  warnings: WarningCollector,
  context: WarningContext,
): PrintReading {
  for (const name of UNCARRIED_PRINT_ATTRIBUTES) {
    const value = attribute(element.element, name)
    if (value !== undefined) {
      warnings.add(
        'unrepresentable:print-detail',
        `A <print> states a ${name} of "${value}", which MNX's pages and systems ` +
          'cannot state.',
        context,
        element.element,
        name,
      )
    }
  }

  // Only "yes" breaks; new-system="no" states the absence of a break, which
  // is also what an unwritten attribute means.
  return {
    systemBreak: attribute(element.element, 'new-system') === 'yes',
    pageBreak: attribute(element.element, 'new-page') === 'yes',
  }
}
