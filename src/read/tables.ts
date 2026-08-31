// Reader tables, held to the model unions they are keyed by.
//
// A table whose keys are a model union is written Record<Union, T>: the
// compiler then demands an entry for every member and refuses one for
// anything else, so the table cannot fall behind the union it restates.
// Walking such a table needs its key type back, which the standard library
// does not give, because Object.entries widens every key to string.

/**
 * A record's entries, keeping the record's own key type.
 *
 * Sound for a record written as an annotated object literal, which is how
 * these tables are written: excess property checking means its keys can only
 * be members of the union it is keyed by.
 */
export function entriesOf<Key extends string, Value>(
  record: Readonly<Record<Key, Value>>,
): readonly (readonly [Key, Value])[] {
  return Object.keys(record).map((key) => [key as Key, record[key as Key]] as const)
}
