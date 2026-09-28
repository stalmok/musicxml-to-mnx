// Holds the engines field in package.json to the Node versions CI runs: .nvmrc
// for the checks, and the ci.yml checks job for the lowest version of every
// other range.

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node
const ranges = engines.split('||').map((range) => range.trim())
const checked = read('.nvmrc').trim()
const job = read('.github/workflows/ci.yml')
  .split(/^ {2}(?=[\w-]+:$)/m)
  .find((block) => block.startsWith('checks:'))
const versions = [...(job ?? '').matchAll(/^ +node-version: '(.*)'$/gm)].map((match) => match[1])

test('CI runs the lowest version of every range but the one the checks run on', () => {
  const floors = ranges
    .filter((range) => range !== `>=${checked}`)
    .map((range) => /^\^(\d+\.\d+\.\d+)$/.exec(range)?.[1] ?? range)

  expect(ranges).toContain(`>=${checked}`)
  expect(versions).toEqual(floors)
})
