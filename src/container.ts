// Getting the MusicXML out of whatever a caller hands us.
//
// MusicXML travels two ways. Raw, it is an XML document. Packed, it is an
// `.mxl`: a zip holding the score alongside a `META-INF/container.xml` that
// names which file inside is the score to read, since a package may carry
// more than one. A caller passing bytes does not say which they have, so the
// zip magic number is what tells them apart.
//
// The unpacking is careful with a hostile package, because this runs on
// untrusted input like the rest of the reader. It decompresses only the
// listing and the one score it names, never the other entries, so a package
// cannot force a large decompression by hiding a bomb beside the score; and it
// refuses a score that decompresses past a sane limit.

import { strFromU8, unzipSync } from 'fflate'
import type { UnzipFileInfo } from 'fflate'
import { MusicXMLError } from './errors.js'
import { child, children } from './xml/tree.js'
import { parseXmlRoot } from './xml/parse.js'

// Every zip begins with these four bytes: "PK\x03\x04".
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

// A score's XML is a few megabytes at most, even for a large orchestral work.
// Anything claiming to decompress past this is not a score a person wrote.
const SCORE_LIMIT = 100 * 1024 * 1024

/**
 * The MusicXML text to parse. A string is already that. Bytes are an `.mxl`
 * when they start with the zip signature, and a raw document otherwise, which
 * this converter reads as UTF-8.
 */
export function readMusicXML(source: string | Uint8Array): string {
  if (typeof source !== 'string' && isZip(source)) return scoreInside(source)
  // Raw text or bytes carry no per-entry size field the way a package does,
  // so their own length is the bound. Without this the package path is capped
  // and the raw path is not, which is the same decompression-bomb size a
  // package is refused for, only unpacked already.
  if (source.length > SCORE_LIMIT) {
    throw new MusicXMLError(
      `The MusicXML document is ${String(source.length)} bytes, over the ` +
        `${String(SCORE_LIMIT)}-byte limit.`,
    )
  }
  return typeof source === 'string' ? source : decode(source)
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
  // Learn the whole file listing while decompressing only the tiny
  // container.xml. The other entries, which may be large, are left packed.
  const names: string[] = []
  const meta = extract(archive, (name) => {
    names.push(name)
    return name === 'META-INF/container.xml'
  })

  const listing = meta['META-INF/container.xml']
  const named = listing ? rootFilePath(listing) : undefined

  // The score is the file the listing names, or, where there is no usable
  // listing, the one score in the package, which is unambiguous when there is
  // exactly one.
  const scores = names.filter(
    (name) => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name),
  )
  const scoreName =
    named !== undefined && names.includes(named)
      ? named
      : scores.length === 1
        ? scores[0]
        : undefined
  if (scoreName === undefined) {
    throw new MusicXMLError(
      named !== undefined
        ? `The .mxl package names "${named}" as its score, but does not contain it.`
        : 'The .mxl package has no META-INF/container.xml naming its score.',
    )
  }

  const score = extract(archive, (name) => name === scoreName)[scoreName]
  /* v8 ignore next -- the name came from this same archive's listing, so the
     second pass always finds it. */
  if (!score) throw new MusicXMLError('The .mxl package could not be unzipped.')
  return decode(score)
}

/**
 * The entries a filter accepts, decompressed; the rest left packed. Refuses an
 * accepted entry that declares a size past the limit before it is inflated,
 * and turns fflate's own errors into a MusicXMLError.
 */
function extract(
  archive: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, Uint8Array> {
  try {
    return unzipSync(archive, {
      filter: (file: UnzipFileInfo) => {
        if (!wanted(file.name)) return false
        if (file.originalSize > SCORE_LIMIT) {
          throw new MusicXMLError(
            `An entry in the .mxl package decompresses to ${String(file.originalSize)} bytes, ` +
              `over the ${String(SCORE_LIMIT)}-byte limit.`,
          )
        }
        return true
      },
    })
  } catch (cause) {
    if (cause instanceof MusicXMLError) throw cause
    throw new MusicXMLError('The .mxl package could not be unzipped.', { cause })
  }
}

/**
 * The path the package's listing gives for its score, or nothing when the
 * listing does not name one. The listing is itself XML, so it is read with the
 * same parser as everything else, which keeps it safe against the
 * external-entity tricks a hand-rolled reader would reopen.
 */
function rootFilePath(listing: Uint8Array): string | undefined {
  const root = parseXmlRoot(decode(listing))
  // A container that carries no <rootfiles> names nothing; the caller then
  // falls back to the one score in the package.
  const rootfiles = child(root, 'rootfiles')
  if (!rootfiles) return undefined

  // The first rootfile is the primary score; the rest, where a package states
  // any, are alternatives this converter does not choose between. The path is
  // always an attribute, never a child element.
  return children(rootfiles, 'rootfile')[0]?.attributes['full-path']
}

/**
 * Bytes as text: UTF-16 where a byte-order mark says so, UTF-8 otherwise.
 * fflate's UTF-8 decoder is used rather than a `TextDecoder` global, so the
 * core stays free of the platform globals the build forbids it. A leading
 * UTF-8 byte-order mark, which would otherwise reach the parser as a stray
 * character before the prolog, is stripped by that decoder as the encoding
 * spec requires.
 */
function decode(bytes: Uint8Array): string {
  // A UTF-16 byte-order mark: fflate decodes UTF-8 only, and Finale ships
  // UTF-16 MusicXML, so it is decoded here by hand. JavaScript strings are
  // UTF-16 code units already, so pairing bytes is the whole of the work and
  // surrogate pairs pass through intact.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return decodeUtf16(bytes, bytes[0] === 0xff)
  }
  return strFromU8(bytes)
}

/** UTF-16 bytes as text, past their byte-order mark. */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) {
    throw new MusicXMLError('The document is UTF-16 but ends in the middle of a character.')
  }

  const units = new Uint16Array((bytes.length - 2) / 2)
  let index = 0
  let first = 0
  for (const byte of bytes.subarray(2)) {
    if (index % 2 === 0) first = byte
    else units[(index - 1) / 2] = littleEndian ? first | (byte << 8) : (first << 8) | byte
    index++
  }
  // Built in chunks: String.fromCharCode takes its units as arguments, and a
  // whole score at once would overflow the argument list.
  const parts: string[] = []
  const CHUNK = 8192
  for (let at = 0; at < units.length; at += CHUNK) {
    parts.push(String.fromCharCode(...units.subarray(at, at + CHUNK)))
  }
  return parts.join('')
}
