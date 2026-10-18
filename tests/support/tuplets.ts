// Builders for tuplet and two-note tremolo reader tests. Every measure states
// 12 divisions to the quarter.

export const DIVISIONS = '<attributes><divisions>12</divisions></attributes>'

/** A <tuplet> marker of the type given, numbered where a number is given. */
export function marker(bracket: string, number?: string): string {
  const numbered = number === undefined ? '' : ` number="${number}"`
  return `<notations><tuplet type="${bracket}"${numbered}/></notations>`
}

/**
 * A note lasting `units` divisions, written as `type`, inside a 3:2 tuplet.
 * `bracket` places the start or stop marker.
 */
export function tupletNote(
  step: string,
  units: number,
  type: string,
  bracket = '',
  number?: string,
): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>${String(units)}</duration><type>${type}</type>` +
    '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
    '</time-modification>' +
    (bracket ? marker(bracket, number) : '') +
    '</note>'
  )
}

/** A quarter outside any ratio, carrying only the bracket marker given. */
export function bracketedNote(step: string, bracket = '', number?: string): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>12</duration>` +
    '<type>quarter</type>' +
    (bracket ? marker(bracket, number) : '') +
    '</note>'
  )
}

/**
 * One note of a two-note tremolo: written as a half, lasting a quarter of
 * the measure (12 divisions), with the pair's 2:1 ratio.
 */
export function tremoloNote(step: string, type: string, marks = '3'): string {
  return (
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    '<duration>12</duration><type>half</type>' +
    '<time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes>' +
    '</time-modification>' +
    `<notations><ornaments><tremolo type="${type}">${marks}</tremolo></ornaments></notations>` +
    '</note>'
  )
}

/** Three eighths in the time of two, which together fill one quarter. */
export const TRIPLET =
  tupletNote('C', 4, 'eighth', 'start') +
  tupletNote('D', 4, 'eighth') +
  tupletNote('E', 4, 'eighth', 'stop')

export function measure(body: string): string {
  return measures(DIVISIONS + body)
}

/** A score of one part, each body its own measure. */
export function measures(...bodies: string[]): string {
  const inner = bodies
    .map((body, index) => `<measure number="${String(index + 1)}">${body}</measure>`)
    .join('')
  return `<score-partwise><part id="P1">${inner}</part></score-partwise>`
}
