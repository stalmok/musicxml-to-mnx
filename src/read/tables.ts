// Reader tables, held to the model unions they restate.
//
// A table whose keys are a model union is written Record<Union, T>, so the
// compiler demands an entry for every member and refuses any other key.
// Object.entries widens every key to string, so entriesOf() gives the key
// type back.
//
// recogniser() does the same for a list of the words a source may write for
// a union.

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
 * The words are given as a table keyed by the union, so the compiler demands
 * a key for every member and refuses any other key. The predicate narrows to
 * the union, so the call site needs no cast.
 *
 * __proto__ cannot be spelled this way, because it sets an object's
 * prototype. Neither format uses that word.
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
