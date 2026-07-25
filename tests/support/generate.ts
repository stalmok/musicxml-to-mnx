// A deterministic MusicXML generator for the performance tests.
//
// The point is size on demand: a score with a chosen number of parts,
// measures, and notes per measure, so the tests can compare conversion time
// across sizes. The content exercises the paths that dominate real songs:
// notes with pitches and types, chords, beams, slurs, and lyrics. One test
// converts a generated score and schema-validates the output, so the
// generator is known to produce legal input and not merely large input.

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
  for (let note = 0; note < score.notesPerMeasure; note++) {
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
    }
    if (note === 0 || note === score.notesPerMeasure - 1) {
      const slur = note === 0 ? 'start' : 'stop'
      lines.push(`        <notations><slur type="${slur}" number="1"/></notations>`)
    }
    lines.push(
      '        <lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>',
      '      </note>',
    )
    // Every downbeat is a two-note chord, so chord grouping is on the
    // measured path too.
    if (note % perBeat === 0) {
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
