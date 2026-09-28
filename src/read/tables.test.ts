// Most of these checks are compile errors, so `pnpm typecheck` runs them, not
// the test runner. A @ts-expect-error that stops being an error fails the type
// check as an unused directive.

import { describe, expect, test } from 'vitest'
import { entriesOf, recogniser } from './tables.js'

type Colour = 'red' | 'green'
type Size = 1 | 2

const isColour = recogniser<Colour>({ red: true, green: true })
const isSize = recogniser<Size>({ 1: true, 2: true })

describe('a recogniser', () => {
  test('accepts the words its union is spelled with, and nothing else', () => {
    expect(isColour('red')).toBe(true)
    expect(isColour('green')).toBe(true)
    expect(isColour('blue')).toBe(false)
    expect(isColour('')).toBe(false)
  })

  test('reads a numeric vocabulary as numbers', () => {
    expect(isSize(1)).toBe(true)
    expect(isSize(3)).toBe(false)
  })

  test('does not accept what a prototype holds', () => {
    expect(isColour('toString')).toBe(false)
    expect(isColour('constructor')).toBe(false)
  })

  test('is short of a word the union states', () => {
    // @ts-expect-error green is a Colour and is missing from the table
    void recogniser<Colour>({ red: true })
    // @ts-expect-error 2 is a Size and is missing from the table
    void recogniser<Size>({ 1: true })
  })

  test('holds a word the union does not state', () => {
    // @ts-expect-error blue is not a Colour
    void recogniser<Colour>({ red: true, green: true, blue: true })
    // @ts-expect-error 3 is not a Size
    void recogniser<Size>({ 1: true, 2: true, 3: true })
  })

  test('is asked about the wrong kind of value', () => {
    // @ts-expect-error a colour is spelled with text, never a number
    void isColour(4)
    // @ts-expect-error a size is a number, never text
    void isSize('1')
  })

  test('narrows to the union, so nothing casts', () => {
    const word: string = 'red'
    if (isColour(word)) {
      const narrowed: Colour = word
      expect(narrowed).toBe('red')
    }
  })
})

describe('entriesOf', () => {
  const lengths: Record<Colour, number> = { red: 3, green: 5 }

  test('gives every entry, in the order the table states them', () => {
    expect(entriesOf(lengths)).toStrictEqual([
      ['red', 3],
      ['green', 5],
    ])
  })

  test('keeps the key type the table was written with', () => {
    const keys: Colour[] = entriesOf(lengths).map(([key]) => key)
    expect(keys).toStrictEqual(['red', 'green'])
  })

  test('is keyed by the union, so a member cannot be left out', () => {
    // @ts-expect-error green is a Colour and is missing
    void ({ red: 3 } satisfies Record<Colour, number>)
    // @ts-expect-error blue is not a Colour
    void ({ red: 3, green: 5, blue: 4 } satisfies Record<Colour, number>)
  })
})
