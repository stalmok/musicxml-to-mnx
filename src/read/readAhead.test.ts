import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseXmlRoot } from '../xml/parse.js'
import type { XmlElement } from '../xml/parse.js'
import { descendants, readAttributeNames, unreadText, wasRead } from '../xml/tree.js'
import { score } from '../../tests/support/musicxml.js'
import * as readAhead from './readAhead.js'
import { timesInForce } from './signatures.js'

// Every read the reader runs ahead of itself. Each one takes the element it
// looks into, and is run on every part and every measure below.
const READ_AHEADS: readonly ((element: XmlElement) => unknown)[] = [
  ...Object.values(readAhead),
  timesInForce,
]

const featureDir = fileURLToPath(new URL('../../tests/corpus/features', import.meta.url))

const OWN = score(`
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <measure-style><multiple-rest>2</multiple-rest></measure-style>
      </attributes>
      <note><rest measure="yes"/><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="3">
      <note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice>
        <type>16th</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="start" number="1"/></notations>
      </note>
      <note>
        <chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>3</voice>
        <type>16th</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <backup><duration>1</duration></backup>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type>
        <notations><ornaments><tremolo type="start">2</tremolo></ornaments></notations>
      </note>
      <forward><duration>1</duration><voice>2</voice></forward>
      <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
    </measure>
  </part>`)

const documents = [
  { name: 'a score stating each thing a read-ahead looks for', source: OWN },
  ...readdirSync(featureDir)
    .filter((file) => file.endsWith('.xml'))
    .sort()
    .map((file) => ({ name: file, source: readFileSync(join(featureDir, file), 'utf8') })),
]

/** Each element, attribute and text something recorded as read. */
function recorded(root: XmlElement): string[] {
  return [root, ...descendants(root)].flatMap((element) => [
    ...(wasRead(element) ? [`<${element.name}>`] : []),
    ...[...(readAttributeNames(element) ?? [])].map((name) => `<${element.name} ${name}>`),
    ...(element.rawText.trim() !== '' && unreadText(element) === undefined
      ? [`<${element.name}> text`]
      : []),
  ])
}

describe('a read ahead of the reader', () => {
  test.each(documents)('records nothing it reads in $name', ({ source }) => {
    const root = parseXmlRoot(source)
    const looked = [...descendants(root)].filter(
      (element) => element.name === 'part' || element.name === 'measure',
    )
    for (const read of READ_AHEADS) for (const element of looked) read(element)

    expect(recorded(root)).toEqual([])
  })
})
