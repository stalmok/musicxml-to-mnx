/**
 * A model shape while it is still being made: the same fields with the
 * readonly taken off. A builder holds one of these and hands over the
 * finished type, which it is assignable to, so nothing needs a cast.
 */
export type Draft<T> = { -readonly [K in keyof T]: T[K] }
