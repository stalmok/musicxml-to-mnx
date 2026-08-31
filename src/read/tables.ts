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
 *
 * The entries come in the order the table states them, except that a key a
 * number could be read as comes first, in rising order, which is how the
 * language enumerates an object. No vocabulary here is spelled with those.
 */
export function entriesOf<Key extends string, Value>(
  record: Readonly<Record<Key, Value>>,
): readonly (readonly [Key, Value])[] {
  return Object.keys(record).map((key) => [key as Key, record[key as Key]] as const)
}

/** How a source spells a vocabulary: as text, or as a number. */
type Spelled<Union> = Union extends string ? string : number

/**
 * A predicate for the whole of a model union, from the words that spell it.
 *
 * The model states a vocabulary as a union, and the reader has to decide
 * whether the word a source wrote is one of them. A bare set cannot say so:
 * nothing connects a set's contents to a union, so the two drift apart in
 * both directions, and the call site casts whatever the set accepted.
 *
 * The words are given as a table keyed by the union, which is the one shape
 * the compiler checks both ways: it demands a key for every member and
 * refuses a key that is not one. The predicate narrows to the union, so the
 * call site needs no cast.
 *
 * One word cannot be spelled this way: __proto__ sets an object's prototype
 * rather than holding a key, so a vocabulary containing it would reject it.
 * Neither format spells anything that way.
 */
export function recogniser<Union extends string | number>(
  words: Readonly<Record<Union, true>>,
): (value: Spelled<Union>) => value is Union & Spelled<Union> {
  // hasOwn reads a number as the string key an object holds it under, which
  // is what a numeric vocabulary such as a time signature's unit needs.
  //
  // The narrowed type meets Spelled because tsc weighs the predicate before
  // it knows the union. Every member of a union of text is text, so for each
  // union this is called with the intersection is the union itself.
  return (value: Spelled<Union>): value is Union & Spelled<Union> => Object.hasOwn(words, value)
}
