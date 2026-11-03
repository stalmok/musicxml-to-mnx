// Reading a <metronome>: a tempo mark.

import type { Fraction } from '../fraction.js'
import type { Tempo } from '../model/score.js'
import type { ReportContext, WarningCollector } from './collector.js'
import { trimmedText } from '../xml/tree.js'
import type { ElementReader } from './element.js'
import { noteValueBaseOf } from './noteValues.js'
import { parseDecimal } from './numbers.js'

export function readMetronome(
  reader: ElementReader,
  position: Fraction,
  warnings: WarningCollector,
  context: ReportContext,
): Tempo[] {
  const element = reader.element
  // MusicXML allows several <beat-unit> children: a second one states the
  // tempo as one note value equalling another. Every part of the mark is read
  // here, because a dropped mark is dropped whole, and the sweep would report
  // an unread part a second time.
  const perMinute = reader.children('per-minute')[0]
  const beatUnit = reader.children('beat-unit')[0]
  const tied = reader.children('beat-unit-tied')
  // A beat unit can be dotted.
  const dots = reader.children('beat-unit-dot').length

  // The mark converts to nothing, and the warning already names the whole of
  // it, so every part that states it goes with it rather than being reported
  // one by one. <metronome-arrows> is among them here, and only here: on a
  // mark that does convert, the arrows are a loss of their own.
  const dropWholeMark = (): Tempo[] => {
    reader.skip(...element.children.map((found) => found.name))
    return []
  }

  // MusicXML can also state a metronome as one note value equalling another,
  // a metrical modulation. MNX states a tempo as a note value and a count of
  // them per minute, and that form carries no number, so there is
  // nothing to put there.
  if (!perMinute || !beatUnit) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> written as one note value equalling another cannot be expressed ' +
        'in MNX, which states a tempo as beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // A <beat-unit> that is not a note value, such as the empty one some
  // exporters write where the mark has no note glyph, drops the mark. MusicXML
  // defines the beat unit as a note value, so it is the source's problem. It
  // is reported, not refused.
  const base = noteValueBaseOf(beatUnit)
  if (!base) {
    warnings.add(
      'unresolved:element-value',
      `A <metronome> states a beat unit of "${trimmedText(beatUnit)}", which is not a note ` +
        'value, so the mark is not converted.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // A beat unit tied to another states a compound beat, such as a quarter
  // tied to an eighth. MNX states a tempo's beat as one note value with dots,
  // which cannot spell every tie, and the first unit alone would state the
  // wrong tempo.
  if (tied.length > 0) {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> whose beat unit is tied to another cannot be expressed in MNX, ' +
        'which states a tempo as one note value and a count of them per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // An empty <per-minute> is valid: it prints the beat-unit glyph alone, with
  // the number supplied as adjacent text. MNX's tempo needs a bpm, so the
  // mark is dropped and reported.
  const written = trimmedText(perMinute)
  if (written === '') {
    warnings.add(
      'unrepresentable:tempo',
      'A <metronome> with no beats-per-minute number cannot be expressed in MNX, ' +
        'which states a tempo as beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  // MusicXML's per-minute is a string, so it can be a word such as "fast",
  // or a number of zero or less. MNX states a tempo as a positive number of
  // beats per minute, so either is dropped and reported.
  //
  // Read as a plain decimal. Number() would read "0x10" as sixteen.
  const bpm = parseDecimal(written)
  if (bpm === undefined || bpm <= 0) {
    warnings.add(
      'unrepresentable:tempo',
      `A <metronome> states its tempo as "${written}", which cannot be expressed in MNX, ` +
        'which states a tempo as a positive number of beats per minute.',
      context,
      element,
    )
    return dropWholeMark()
  }

  return [{ position, value: { base, dots }, bpm }]
}
