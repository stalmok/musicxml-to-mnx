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

// The fixture above is one voice in one measure. Real music is not, and the
// shapes that only appear in harder music (spaces, several sequences, chords,
// a rest filling the measure) would otherwise never be schema-checked as
// conversion output.
describe('conversion output the schema has to accept', () => {
  const cases: Record<string, string> = {
    'two voices, one entering late':
      '<attributes><divisions>4</divisions></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration>' +
      '<voice>1</voice></note>' +
      '<backup><duration>4</duration></backup>' +
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration>' +
      '<voice>2</voice></note>',
    'a chord':
      '<attributes><divisions>4</divisions></attributes>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>' +
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note>',
    'a rest filling the measure':
      '<attributes><divisions>4</divisions></attributes>' +
      '<note><rest measure="yes"/><duration>16</duration></note>',
    'a triplet':
      '<attributes><divisions>12</divisions></attributes>' +
      ['start', '', 'stop']
        .map(
          (bracket) =>
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>' +
            '<type>eighth</type><time-modification><actual-notes>3</actual-notes>' +
            '<normal-notes>2</normal-notes></time-modification>' +
            (bracket ? `<notations><tuplet type="${bracket}"/></notations>` : '') +
            '</note>',
        )
        .join(''),
    'a grace note':
      '<attributes><divisions>4</divisions></attributes>' +
      '<note><grace slash="yes"/><pitch><step>B</step><octave>4</octave></pitch>' +
      '<type>eighth</type></note>' +
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>',
    'a value recovered from its duration':
      '<attributes><divisions>4</divisions></attributes>' +
      '<note><rest/><duration>6</duration></note>',
  }

  test.each(Object.entries(cases))('%s', (_name, body) => {
    const source = `<score-partwise><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`

    expect(schemaErrors(convertMusicXML(source).mnx)).toEqual([])
  })
})
