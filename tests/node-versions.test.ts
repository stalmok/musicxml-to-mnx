// The Node versions the package claims to run on, held to the versions CI
// runs it on. package.json's engines field is the claim, .nvmrc the Node the
// checks run on, and the node-versions job in ci.yml runs the lowest version
// of every other range.

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node
const ranges = engines.split('||').map((range) => range.trim())
const checked = read('.nvmrc').trim()
const matrix = /^\s+node: \[(.*)\]$/m.exec(read('.github/workflows/ci.yml'))?.[1]

test('CI runs the lowest version of every range but the one the checks run on', () => {
  const floors = ranges
    .filter((range) => range !== `>=${checked}`)
    .map((range) => /^\^(\d+\.\d+\.\d+)$/.exec(range)?.[1] ?? range)

  expect(ranges).toContain(`>=${checked}`)
  expect(matrix?.split(',').map((version) => version.trim().replace(/'/g, ''))).toEqual(floors)
})
