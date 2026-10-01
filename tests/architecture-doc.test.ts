// Compares the module tables in docs/architecture.md with the files on disk.
// The tables are a second copy of the source layout, and a new module does
// not show in them unless someone adds it. This checks that each module has
// a row and each row has a module. It cannot check that a row's description
// is still true.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const doc = readFileSync(join(root, 'docs/architecture.md'), 'utf8')

// The names in the first column of the table rows under heading, up to the
// next heading. A cell can name more than one module, as in
// `part-groups.ts`, `print.ts`.
function tableModules(heading: string): string[] {
  const start = doc.indexOf(`\n${heading}\n`)
  expect(start, `docs/architecture.md has no "${heading}" section`).toBeGreaterThan(-1)
  const section = doc.slice(start + heading.length + 2)
  const end = section.search(/\n#{1,3} /)
  const rows = (end === -1 ? section : section.slice(0, end))
    .split('\n')
    .filter((line) => line.startsWith('| `'))
  return rows.flatMap((row) => {
    const cell = row.split('|')[1] ?? ''
    return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '')
  })
}

function shippedFiles(directory: string): string[] {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(join(root, path)).isDirectory()) return shippedFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

describe('the module boundaries table', () => {
  const rows = tableModules('## Module boundaries')

  test('covers every shipped file, by its own row or its directory', () => {
    const files = [...shippedFiles('src'), ...shippedFiles('cli')]
    const uncovered = files.filter(
      (file) => !rows.some((row) => (row.endsWith('/') ? file.startsWith(row) : file === row)),
    )
    expect(uncovered).toEqual([])
  })

  test('names only files and directories that exist', () => {
    const missing = rows.filter((row) => {
      try {
        statSync(join(root, row))
        return false
      } catch {
        return true
      }
    })
    expect(missing).toEqual([])
  })
})

describe('the reader modules table', () => {
  test('lists exactly the shipped files in src/read', () => {
    const files = shippedFiles('src/read').map((file) => relative('src/read', file))
    expect(tableModules('## Reader').sort()).toEqual(files.sort())
  })
})
