// Pretty-printed MusicXML writes an element's text on its own line, indented,
// so the text a reader gets carries the surrounding whitespace. Every value
// the reader compares against a recogniser has to be trimmed first, or the
// comparison fails and the value reads as unknown.
//
// The fixtures elsewhere all write element text with nothing around it, so
// nothing states that the reader accepts a file laid out this way. This does.

import { describe, expect, test } from 'vitest'
import { convertMusicXML } from '../index.js'
import { schemaErrors } from '../../tests/support/schema.js'

// Every value here sits on its own line, indented, the way a pretty-printer
// writes it: the pitch, the note value, the clef, the stem, the syllable and
// the height a rest is pinned to.
const PRETTY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>
        Music
      </part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>
          4
        </divisions>
        <time>
          <beats>
            2
          </beats>
          <beat-type>
            4
          </beat-type>
        </time>
        <clef>
          <sign>
            G
          </sign>
          <line>
            2
          </line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>
            C
          </step>
          <octave>
            5
          </octave>
        </pitch>
        <duration>
          4
        </duration>
        <type>
          quarter
        </type>
        <stem>
          up
        </stem>
        <lyric number="1">
          <syllabic>
            begin
          </syllabic>
          <text>
            La
          </text>
        </lyric>
      </note>
      <note>
        <rest>
          <display-step>
            G
          </display-step>
          <display-octave>
            4
          </display-octave>
        </rest>
        <duration>
          4
        </duration>
        <type>
          quarter
        </type>
      </note>
    </measure>
  </part>
</score-partwise>`

const converted = convertMusicXML(PRETTY)
const measure = converted.mnx.parts[0]?.measures[0]
const [note, rest] = measure?.sequences[0]?.content ?? []

describe('a pretty-printed source', () => {
  test('converts to legal MNX with nothing reported lost', () => {
    expect(schemaErrors(converted.mnx)).toEqual([])
    expect(converted.warnings).toEqual([])
  })

  test('reads the pitch, the note value and the stem direction', () => {
    expect(note).toMatchObject({
      duration: { base: 'quarter' },
      stemDirection: 'up',
      notes: [{ pitch: { step: 'C', octave: 5 } }],
    })
  })

  test('reads the syllable and how it joins its neighbour', () => {
    expect(note).toMatchObject({ lyrics: { lines: { 1: { text: 'La', type: 'start' } } } })
  })

  test('reads the height a rest is pinned to', () => {
    // G4 sits two steps below the middle line of a treble staff.
    expect(rest).toMatchObject({ rest: { staffPosition: -2 } })
  })

  test('reads the part name and the time signature', () => {
    expect(converted.mnx.parts[0]?.name).toBe('Music')
    expect(converted.mnx.global.measures[0]?.time).toEqual({ count: 2, unit: 4 })
  })
})
