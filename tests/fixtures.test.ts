// Every fixture is a MusicXML file paired with the MNX it must produce.
// Adding a pair under tests/fixtures/ registers it here automatically.
//
// Two gates per fixture: the output equals its golden, and the output
// conforms to the vendored MNX schema. The golden pins what we decided to
// emit; the schema pins that the decision is legal MNX.

import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertMusicXML } from '../src/index.js'
import { schemaErrors } from './support/schema.js'

const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url))

interface Fixture {
  name: string
  musicXmlPath: string
  goldenPath: string
}

function findFixtures(directory: string, prefix = ''): Fixture[] {
  const found: Fixture[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...findFixtures(path, `${prefix}${entry.name}/`))
    } else if (entry.name.endsWith('.musicxml')) {
      const base = entry.name.slice(0, -'.musicxml'.length)
      found.push({
        name: `${prefix}${base}`,
        musicXmlPath: path,
        goldenPath: join(directory, `${base}.mnx`),
      })
    }
  }
  return found
}

const fixtures = findFixtures(fixturesRoot)

test('there are fixtures to run', () => {
  expect(fixtures.length).toBeGreaterThan(0)
})

describe.each(fixtures)('$name', ({ musicXmlPath, goldenPath }) => {
  const source = readFileSync(musicXmlPath, 'utf8')

  test('converts to the expected MNX', () => {
    const { mnx } = convertMusicXML(source)
    const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'))

    expect(mnx).toEqual(golden)
  })

  test('produces MNX that conforms to the spec schema', () => {
    const { mnx } = convertMusicXML(source)

    expect(schemaErrors(mnx)).toEqual([])
  })

  test('converts without losing anything', () => {
    const { warnings } = convertMusicXML(source)

    expect(warnings).toEqual([])
  })
})
