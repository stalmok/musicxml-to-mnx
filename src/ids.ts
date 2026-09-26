// The ids the converter writes into an MNX document. The reader names events,
// notes and kit components, and the writer names measures and the layout.
// MNX gives every id one shape, so a part or instrument id from the source can
// clash with a generated one, and the reader renames it against the pattern here.

// MNX's id, from the schema's $defs/id: 1 to 256 printable ASCII characters.
// MusicXML's part id is an xs:ID, which allows more, such as accented letters.
//
// Copied rather than read: the schema and ajv are dev-only, and converting a
// score must not depend on either. The conformance test holds this copy to
// $defs/id.pattern.
export const MNX_ID_PATTERN = /^[\x21-\x7E]{1,256}$/

const PREFIXES = {
  event: 'ev',
  note: 'note',
  kitComponent: 'kit',
  measure: 'm',
} as const

export type CountedId = keyof typeof PREFIXES

/** The id of the nth thing of its kind, counted from 1. */
export function countedId(kind: CountedId, n: number): string {
  return `${PREFIXES[kind]}${String(n)}`
}

/** The id of the one layout the writer states. */
export const LAYOUT_ID = 'layout1'

const NAMES: Record<CountedId, string> = {
  event: 'event',
  note: 'note',
  kitComponent: 'kit component',
  measure: 'measure',
}

/** What the ids GENERATED_ID_PATTERN matches name, for a warning message. */
export const GENERATED_ID_KINDS = `${Object.values(NAMES).join(', ')} or layout`

/** Every id countedId and LAYOUT_ID can give. */
export const GENERATED_ID_PATTERN = new RegExp(
  `^(?:${Object.values(PREFIXES).join('|')})\\d+$|^${LAYOUT_ID}$`,
)
