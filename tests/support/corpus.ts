// Reading the vendored songs.
//
// They are stored as `.mxl`, the standard compressed MusicXML container,
// which is what the corpus publishes and is around twenty times smaller than
// the XML inside it. Fifty songs come to under a megabyte that way, against
// nearly twenty uncompressed.
//
// A container holds its own file listing in META-INF/container.xml naming the
// root score, so that is what is followed rather than guessing at the name.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'

const corpusDir = fileURLToPath(new URL('../corpus', import.meta.url))

export interface Song {
  /** The file name, without its extension. */
  name: string
  /** The MusicXML inside the container. */
  source: string
}

function scoreInside(archive: Uint8Array, name: string): string {
  const files = unzipSync(archive)

  const container = files['META-INF/container.xml']
  if (container) {
    const rootfile = /full-path="([^"]+)"/.exec(strFromU8(container))?.[1]
    const score = rootfile ? files[rootfile] : undefined
    if (score) return strFromU8(score)
  }

  // No listing, or it names something absent: fall back to the only score in
  // the container.
  const fallback = Object.entries(files).find(
    ([path]) => !path.startsWith('META-INF/') && /\.(musicxml|xml)$/.test(path),
  )
  if (!fallback) throw new Error(`${name} holds no score.`)
  return strFromU8(fallback[1])
}

/** Every vendored song, in a stable order. */
export function songs(): Song[] {
  return readdirSync(corpusDir)
    .filter((file) => file.endsWith('.mxl'))
    .sort()
    .map((file) => ({
      name: file.replace('.mxl', ''),
      source: scoreInside(readFileSync(join(corpusDir, file)), file),
    }))
}
