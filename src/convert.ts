// The conversion pipeline, end to end.

import { readMusicXML } from './container.js'
import { MusicXMLError } from './errors.js'
import { readScore } from './read/score.js'
import type { MNXDocument } from './types/mnx.js'
import { WarningCollector } from './warnings.js'
import type { ConversionWarning } from './warnings.js'
import { writeMnx } from './write/mnx.js'
import type { WriterOptions } from './write/mnx.js'
import { parseXmlRoot } from './xml/parse.js'

/** What a caller can say about the conversion. */
export interface ConversionOptions extends WriterOptions {
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
 * are read as UTF-8.
 *
 * @throws {MusicXMLError} if the source is not well-formed, or encodes
 * something that cannot be converted faithfully.
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
    // Named here because this is the only place that knows the name: the
    // container, the parser and the reader all throw, and none of them is
    // told what the source was called.
    if (name === undefined || !(error instanceof MusicXMLError)) throw error
    throw error.inDocument(name)
  }
}
