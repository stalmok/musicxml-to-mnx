// Public exports. Consumers import only from here. The score model in
// src/model/ is internal and not exported.

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

// Every MNX type, so a consumer can name any node in an MNXDocument and its
// own declaration files compile.
export type * from './types/mnx.js'
