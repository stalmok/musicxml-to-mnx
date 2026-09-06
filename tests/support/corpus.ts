// Reading the vendored scores.
//
// Two sets, read together, because every check in the corpus test applies to
// both. The songs are stored as `.mxl`, the standard compressed MusicXML
// container, which is what the corpus publishes and is around twenty times
// smaller than the XML inside it. The unpacking is the library's own, so the
// corpus tests read the bytes the same way a consumer would and exercise that
// path against real packages.
//
// The feature files are stored as the `.xml` their suite publishes, small
// enough to read in a diff, so that what each one is there to exercise can be
// seen rather than taken on trust. See tests/corpus/PROVENANCE.md.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMusicXML } from '../../src/container.js'

const corpusDir = fileURLToPath(new URL('../corpus', import.meta.url))
const featureDir = join(corpusDir, 'features')

export interface Song {
  /** The file name, without its extension. */
  name: string
  /** The MusicXML inside the container. */
  source: string
}

/** Every vendored score, in a stable order: the songs, then the feature files. */
export function songs(): Song[] {
  const packaged = readdirSync(corpusDir)
    .filter((file) => file.endsWith('.mxl'))
    .sort()
    .map((file) => ({
      name: file.replace('.mxl', ''),
      source: readMusicXML(new Uint8Array(readFileSync(join(corpusDir, file)))),
    }))

  const plain = readdirSync(featureDir)
    .filter((file) => file.endsWith('.xml'))
    .sort()
    .map((file) => ({
      name: file.replace('.xml', ''),
      source: readFileSync(join(featureDir, file), 'utf8'),
    }))

  return [...packaged, ...plain]
}
