// Reader tables, held to the model unions they restate.
//
// A table whose keys are a model union is written Record<Union, T>: the
// compiler then demands an entry for every member and refuses one for
// anything else, so the table cannot fall behind the union it restates.
// Walking such a table needs its key type back, which the standard library
// does not give, because Object.entries widens every key to string.
//
// A list of the words a source may write for a union is the same problem in
// a shape Record cannot state, and recogniser() is that shape.

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

/**
 * A predicate for the whole of a model union, from the words that spell it.
 *
 * The model states a vocabulary as a union, and the reader has to decide
 * whether the word a source wrote is one of them. A bare set cannot say so:
 * nothing connects a set's contents to a union, so the two drift apart in
 * both directions, and the call site casts whatever the set accepted.
 *
 * A word the union lacks fails the constraint on the list. A member the union
 * has and the list lacks leaves the call an argument short, and the argument
 * it asks for is the member missing. The predicate narrows to the union, so
 * the call site needs no cast.
 *
 * Called in two steps because TypeScript infers every type argument or none:
 * the union is stated, the words are inferred.
 */
export function recogniser<Union extends string | number>() {
  return <const Words extends readonly Union[]>(
    words: Words,
    ..._unlisted: [Exclude<Union, Words[number]>] extends [never]
      ? []
      : [missingFromTheList: Exclude<Union, Words[number]>]
  ) => {
    const known: ReadonlySet<unknown> = new Set<Union>(words)
    return <Value extends string | number>(value: Value): value is Value & Union => known.has(value)
  }
}
