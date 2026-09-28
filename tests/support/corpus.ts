// Reads the two vendored sets, the songs and the feature files. Every check in
// the corpus test applies to both.
//
// The songs are stored as `.mxl`, the compressed MusicXML container that the
// corpus publishes. The library's own unpacking reads them.
//
// The feature files are stored as the `.xml` their suite publishes, small
// enough to read in a diff. See tests/corpus/PROVENANCE.md.

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
