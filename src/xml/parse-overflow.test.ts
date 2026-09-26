import { expect, test, vi } from 'vitest'
import { parseXmlRoot } from './parse.js'

// Node cannot raise the error another engine throws on a stack overflow, so
// the parser throws them here.
const thrown = vi.hoisted(() => ({ error: new Error() }))

vi.mock('@rgrove/parse-xml', async (original) => ({
  ...(await original<typeof import('@rgrove/parse-xml')>()),
  parseXml: () => {
    throw thrown.error
  },
}))

function named(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

test("reads Firefox's stack overflow as a document nested too deeply", () => {
  thrown.error = named('InternalError', 'too much recursion')

  expect(() => parseXmlRoot('<a/>')).toThrow('The document is nested too deeply to read.')
})

test.each([
  ['RangeError', 'Invalid string length'],
  ['Error', 'Maximum call stack size exceeded'],
])('keeps the message of a %s that is not a stack overflow', (name, message) => {
  thrown.error = named(name, message)

  expect(() => parseXmlRoot('<a/>')).toThrow(message)
})
