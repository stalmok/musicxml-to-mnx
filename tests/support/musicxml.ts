// Builders for the smallest MusicXML documents a reader test needs.

/** Wraps `body` in the smallest document that can carry it. */
export function score(body: string): string {
  return `<score-partwise version="4.0">${body}</score-partwise>`
}

/** Wraps `body` in a one-part, one-measure document. */
export function measure(body: string): string {
  return score(`<part id="P1"><measure number="1">${body}</measure></part>`)
}

export const NOTE = '<note><pitch><step>C</step><octave>4</octave></pitch><type>whole</type></note>'

/** A note that takes time, for a mark whose point in the measure is the subject. */
export const QUARTER =
  '<note><pitch><step>C</step><octave>4</octave></pitch>' +
  '<duration>4</duration><type>quarter</type></note>'
