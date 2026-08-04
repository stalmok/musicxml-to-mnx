// Reading the vendored songs.
//
// They are stored as `.mxl`, the standard compressed MusicXML container,
// which is what the corpus publishes and is around twenty times smaller than
// the XML inside it.
//
// The unpacking is the library's own, so the corpus tests read the bytes the
// same way a consumer would and exercise that path against real packages.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMusicXML } from '../../src/container.js'

const corpusDir = fileURLToPath(new URL('../corpus', import.meta.url))

export interface Song {
  /** The file name, without its extension. */
  name: string
  /** The MusicXML inside the container. */
  source: string
}

/** Every vendored song, in a stable order. */
export function songs(): Song[] {
  return readdirSync(corpusDir)
    .filter((file) => file.endsWith('.mxl'))
    .sort()
    .map((file) => ({
      name: file.replace('.mxl', ''),
      source: readMusicXML(new Uint8Array(readFileSync(join(corpusDir, file)))),
    }))
}
