// A deterministic MusicXML generator for the performance tests.
//
// The point is size on demand: a score with a chosen number of parts,
// measures, and notes per measure, so the tests can compare conversion time
// across sizes. The content exercises the paths that dominate real songs:
// notes with pitches and types, chords, beams, slurs, lyrics, and a hairpin
// worded at its closing edge. One test converts a generated score and
// schema-validates the output, so the generator is known to produce legal
// input and not merely large input.

export interface GeneratedScore {
  /** How many parts. */
  parts: number
  /** How many measures per part. */
  measures: number
  /** Notes per measure: 4 (quarters), 8 (eighths), or 16 (sixteenths). */
  notesPerMeasure: 4 | 8 | 16
}

const noteTypes = { 4: 'quarter', 8: 'eighth', 16: '16th' } as const
const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

/** The MusicXML text of a score of the given size. */
export function generateScore(score: GeneratedScore): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<score-partwise version="4.0">',
    '  <part-list>',
  ]
  for (let part = 1; part <= score.parts; part++) {
    lines.push(
      `    <score-part id="P${part}">`,
      `      <part-name>Part ${part}</part-name>`,
      '    </score-part>',
    )
  }
  lines.push('  </part-list>')
  for (let part = 1; part <= score.parts; part++) {
    lines.push(`  <part id="P${part}">`)
    for (let measure = 1; measure <= score.measures; measure++) {
      lines.push(...measureLines(score, measure))
    }
    lines.push('  </part>')
  }
  lines.push('</score-partwise>', '')
  return lines.join('\n')
}

function measureLines(score: GeneratedScore, measure: number): string[] {
  const lines = [`    <measure number="${measure}">`]
  if (measure === 1) {
    lines.push(
      '      <attributes>',
      '        <divisions>4</divisions>',
      '        <key><fifths>0</fifths></key>',
      '        <time><beats>4</beats><beat-type>4</beat-type></time>',
      '        <clef><sign>G</sign><line>2</line></clef>',
      '      </attributes>',
    )
  }
  const duration = 16 / score.notesPerMeasure
  const type = noteTypes[score.notesPerMeasure]
  const beamed = score.notesPerMeasure > 4
  const perBeat = score.notesPerMeasure / 4
  // A hairpin over the measure, opened here and closed before the last note.
  // Both ends wait for the whole part to be read before they are paired, so
  // this puts the spanner pairing on the measured path.
  lines.push(
    '      <direction>',
    '        <direction-type><wedge type="crescendo" number="1"/></direction-type>',
    '      </direction>',
  )
  for (let note = 0; note < score.notesPerMeasure; note++) {
    // The wording at the closing edge becomes the hairpin's suffix, which the
    // pairing settles once the part is in, and the stop closes the hairpin.
    if (note === score.notesPerMeasure - 1) {
      lines.push(
        '      <direction>',
        '        <direction-type>',
        '          <dynamics><other-dynamics>cresc.</other-dynamics></dynamics>',
        '          <wedge type="stop" number="1"/>',
        '        </direction-type>',
        '      </direction>',
      )
    }
    const step = steps[((measure - 1) * score.notesPerMeasure + note) % steps.length] ?? 'C'
    lines.push(
      '      <note>',
      `        <pitch><step>${step}</step><octave>4</octave></pitch>`,
      `        <duration>${duration}</duration>`,
      `        <type>${type}</type>`,
    )
    if (beamed) {
      const inBeat = note % perBeat
      const state = inBeat === 0 ? 'begin' : inBeat === perBeat - 1 ? 'end' : 'continue'
      lines.push(`        <beam number="1">${state}</beam>`)
      // Sixteenths beam at two levels, as real music writes them.
      if (score.notesPerMeasure === 16) {
        lines.push(`        <beam number="2">${state}</beam>`)
      }
    }
    if (note === 0 || note === score.notesPerMeasure - 1) {
      const slur = note === 0 ? 'start' : 'stop'
      lines.push(`        <notations><slur type="${slur}" number="1"/></notations>`)
    }
    lines.push(
      '        <lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>',
      '      </note>',
    )
    // Every fourth note is a two-note chord, so chord grouping is on the
    // measured path and the note count still scales exactly with
    // notesPerMeasure, which the scaling tests divide by.
    if (note % 4 === 0) {
      lines.push(
        '      <note>',
        '        <chord/>',
        `        <pitch><step>${step}</step><octave>5</octave></pitch>`,
        `        <duration>${duration}</duration>`,
        `        <type>${type}</type>`,
        '      </note>',
      )
    }
  }
  lines.push('    </measure>')
  return lines
}
