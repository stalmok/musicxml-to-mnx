// Getting the MusicXML out of whatever a caller hands us.
//
// MusicXML travels two ways. Raw, it is an XML document. Packed, it is an
// `.mxl`: a zip holding the score alongside a `META-INF/container.xml` that
// names which file inside is the score to read, since a package may carry
// more than one. A caller passing bytes does not say which they have, so the
// zip magic number is what tells them apart.

import { strFromU8, unzipSync } from 'fflate'
import { MusicXMLError } from './errors.js'
import { children, requireChild } from './xml/tree.js'
import { parseXmlRoot } from './xml/parse.js'

// Every zip begins with these four bytes: "PK\x03\x04".
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/**
 * The MusicXML text to parse. A string is already that. Bytes are an `.mxl`
 * when they start with the zip signature, and a raw document otherwise, which
 * this converter reads as UTF-8.
 */
export function readMusicXML(source: string | Uint8Array): string {
  if (typeof source === 'string') return source
  if (isZip(source)) return scoreInside(source)
  return decode(source)
}

function isZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * The score inside an `.mxl`. The package's own `container.xml` names it,
 * because a package may hold several files and only its listing says which is
 * the score rather than, say, a cover image or a second movement.
 */
function scoreInside(archive: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archive)
  } catch (cause) {
    throw new MusicXMLError('The .mxl package could not be unzipped.', { cause })
  }

  const named = rootFilePath(files)
  const score = named ? files[named] : undefined
  if (score) return decode(score)

  // No listing, or it names a file the package does not hold: fall back to the
  // one score inside, which is unambiguous when there is exactly one.
  const scores = Object.keys(files).filter(
    (path) => !path.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(path),
  )
  const only = scores[0]
  if (scores.length === 1 && only) return decode(files[only] as Uint8Array)

  throw new MusicXMLError(
    named
      ? `The .mxl package names "${named}" as its score, but does not contain it.`
      : 'The .mxl package has no META-INF/container.xml naming its score.',
  )
}

/**
 * The path the package's listing gives for its score, or nothing when it has
 * no listing. The listing is itself XML, so it is read with the same parser as
 * everything else, which keeps it safe against the external-entity tricks a
 * hand-rolled reader would reopen.
 */
function rootFilePath(files: Record<string, Uint8Array>): string | undefined {
  const listing = files['META-INF/container.xml']
  if (!listing) return undefined

  const root = parseXmlRoot(decode(listing))
  const path: readonly string[] = ['container']
  const rootfiles = requireChild(root, 'rootfiles', path)
  // The first rootfile is the primary score; the rest, where a package states
  // any, are alternatives this converter does not choose between. The path is
  // always an attribute, never a child element.
  const first = children(rootfiles, 'rootfile')[0]
  return first?.attributes['full-path']
}

/**
 * Bytes as UTF-8 text. fflate's decoder is used rather than a `TextDecoder`
 * global, so the core stays free of the platform globals the build forbids it.
 * A leading byte-order mark, which would otherwise reach the parser as a stray
 * character before the prolog, is stripped by that decoder as the encoding
 * spec requires.
 */
function decode(bytes: Uint8Array): string {
  return strFromU8(bytes)
}
