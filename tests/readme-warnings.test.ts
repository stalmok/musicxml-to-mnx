// Compares the warning prefix table in README.md with the warning codes.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  isConverterGap,
  isFormatLimit,
  isSourceProblem,
  WARNING_CODES,
  type WarningCode,
} from '../src/index.js'

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')

const HELPERS: Readonly<Record<string, (code: WarningCode) => boolean>> = {
  isConverterGap,
  isFormatLimit,
  isSourceProblem,
}

// The rows under the sentence that introduces the table, each as its
// prefixes and the helper it names.
function prefixRows(): { prefixes: string[]; helper: string }[] {
  const start = readme.indexOf('Warning prefixes identify three categories:')
  expect(start, 'README.md has no warning prefix table').toBeGreaterThan(-1)
  const table = readme.slice(start).split('\n\n')[1] ?? ''
  return table
    .split('\n')
    .slice(2)
    .map((row) => {
      const [, prefixes = '', , helper = ''] = row.split('|')
      return {
        prefixes: [...prefixes.matchAll(/`([a-z-]+):`/g)].map((match) => match[1] ?? ''),
        helper: /`(\w+)\(code\)`/.exec(helper)?.[1] ?? '',
      }
    })
}

function prefixOf(code: WarningCode): string {
  return code.slice(0, code.indexOf(':'))
}

describe('the warning prefix table in README.md', () => {
  const rows = prefixRows()

  test('names a helper the package exports in each row', () => {
    expect(rows.map((row) => row.helper).sort()).toEqual(Object.keys(HELPERS).sort())
  })

  test('puts each warning code under the helper that accepts it', () => {
    const wrong = WARNING_CODES.filter((code) => {
      const row = rows.find((one) => one.prefixes.includes(prefixOf(code)))
      return row === undefined || !HELPERS[row.helper]?.(code)
    })
    expect(wrong).toEqual([])
  })

  test('names each prefix once', () => {
    const named = rows.flatMap((row) => row.prefixes)
    expect(named.filter((prefix, index) => named.indexOf(prefix) !== index)).toEqual([])
  })

  test('names only prefixes some warning code has', () => {
    const used = new Set(WARNING_CODES.map(prefixOf))
    expect(rows.flatMap((row) => row.prefixes).filter((prefix) => !used.has(prefix))).toEqual([])
  })
})
