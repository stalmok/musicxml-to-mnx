// The conversion pipeline, end to end.

import { readScore } from './read/score.js'
import type { MNXDocument } from './types/mnx.js'
import { WarningCollector } from './warnings.js'
import type { ConversionWarning } from './warnings.js'
import { writeMnx } from './write/mnx.js'
import { parseXmlRoot } from './xml/parse.js'

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
 * @throws {MusicXMLError} if the source is not well-formed, or encodes
 * something that cannot be converted faithfully.
 */
export function convertMusicXML(source: string): ConversionResult {
  const warnings = new WarningCollector()
  const score = readScore(parseXmlRoot(source), warnings)

  return { mnx: writeMnx(score), warnings: warnings.list() }
}
