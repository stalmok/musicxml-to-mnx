// The conversion pipeline, end to end.

import { readMusicXML } from './container.js'
import { readScore } from './read/score.js'
import type { MNXDocument } from './types/mnx.js'
import { WarningCollector } from './warnings.js'
import type { ConversionWarning } from './warnings.js'
import { writeMnx } from './write/mnx.js'
import type { WriterOptions } from './write/mnx.js'
import { parseXmlRoot } from './xml/parse.js'

/** What a caller can say about the conversion. */
export type ConversionOptions = WriterOptions

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
  const score = readScore(parseXmlRoot(readMusicXML(source)), warnings)

  return { mnx: writeMnx(score, options), warnings: warnings.list() }
}
