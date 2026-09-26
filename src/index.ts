// Public exports. Consumers import only from here.
//
// The score model in src/model/ is deliberately absent: it is an internal
// boundary between the reader and the writer, not API.

export { convertMusicXML } from './convert.js'
export type { ConversionOptions, ConversionResult } from './convert.js'

export { MusicXMLError } from './errors.js'
export type { DocumentPath } from './errors.js'

export {
  categoryOf,
  isConverterGap,
  isFormatLimit,
  isSourceProblem,
  WARNING_CODES,
} from './warnings.js'
export type {
  ConversionWarning,
  ConverterGap,
  FormatLimit,
  SourceProblem,
  WarningCategory,
  WarningCode,
  WarningContext,
} from './warnings.js'

// The whole output vocabulary, not a selection: a consumer holding an
// MNXDocument needs to be able to name any node inside it, both to write
// helpers over one and to have their own declaration files compile.
export type * from './types/mnx.js'
