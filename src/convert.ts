// The conversion pipeline, end to end.

import { readMusicXML } from './container.js'
import { MusicXMLError } from './errors.js'
import { InexactFractionError } from './fraction.js'
import { readScore } from './read/score.js'
import type { MNXDocument } from './types/mnx.js'
import { WarningCollector } from './warnings.js'
import type { ConversionWarning } from './warnings.js'
import { writeMnx } from './write/mnx.js'
import { parseXmlRoot } from './xml/parse.js'

/** What a caller can say about the conversion. */
export interface ConversionOptions {
  /**
   * The name of the score rendering the output writes. MNX requires one to be
   * named, and MusicXML has nothing that answers it: a work's title names the
   * work, not a rendering of it. Defaults to "Score".
   */
  scoreName?: string
  /**
   * What to call the source in any refusal it produces. A source is text or
   * bytes, so the converter cannot know it came from a file; a caller
   * converting more than one names them here rather than adding the name to
   * the message afterwards.
   */
  documentName?: string
}

export interface ConversionResult {
  /** The converted document. */
  mnx: MNXDocument
  /**
   * Everything the source expressed that the output does not carry. Empty
   * means the conversion was lossless as far as this converter can tell.
   */
  warnings: readonly ConversionWarning[]
}

/**
 * Converts a MusicXML document to MNX.
 *
 * The source is either the XML text, or the bytes of a document or an `.mxl`
 * package, which is told apart by its zip signature and unpacked. Raw bytes
 * are decoded by their byte-order mark, or else by the encoding their XML
 * declaration names, or else as UTF-8.
 *
 * @throws {MusicXMLError} if the source is not well-formed, is bytes in an
 * encoding this converter does not read, is bytes that break their encoding,
 * or encodes something that cannot be converted faithfully.
 */
export function convertMusicXML(
  source: string | Uint8Array,
  options: ConversionOptions = {},
): ConversionResult {
  const warnings = new WarningCollector()
  const name = options.documentName
  try {
    const score = readScore(parseXmlRoot(readMusicXML(source)), warnings)

    return { mnx: writeMnx(score, options), warnings: warnings.list() }
  } catch (error) {
    const refusal = asRefusal(error)
    // Named here because this is the only place that knows the name: the
    // container, the parser and the reader all throw, and none of them is
    // told what the source was called.
    if (name === undefined || !(refusal instanceof MusicXMLError)) throw refusal
    throw refusal.inDocument(name)
  }
}

// A duration that cannot be held exactly comes from the source's own
// <divisions> and <duration> values, so it is a refusal of the document.
function asRefusal(error: unknown): unknown {
  if (!(error instanceof InexactFractionError)) return error
  return new MusicXMLError(error.message, { path: [], cause: error })
}
