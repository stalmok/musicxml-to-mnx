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
 * when they start with the zip signature, and a raw document otherwise, decoded
 * by its byte-order mark, else its declared encoding, else as UTF-8.
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
      { path: [] },
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
      { path: [] },
    )
  }

  const score = extract(archive, (name) => name === scoreName)[scoreName]
  /* v8 ignore next -- the name came from this same archive's listing, so the
     second pass always finds it. */
  if (!score) throw new MusicXMLError('The .mxl package could not be unzipped.', { path: [] })
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
            { path: [] },
          )
        }
        return true
      },
    })
  } catch (cause) {
    if (cause instanceof MusicXMLError) throw cause
    throw new MusicXMLError('The .mxl package could not be unzipped.', { path: [], cause })
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
 * Bytes as text. A byte-order mark decides first, then the encoding the XML
 * declaration names, then UTF-8, which XML assumes when neither is present.
 * No `TextDecoder` global is used, so the core stays free of the platform
 * globals the build forbids it.
 */
function decode(bytes: Uint8Array): string {
  // Finale ships UTF-16 MusicXML, always with a byte-order mark.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return decodeUtf16(bytes, bytes[0] === 0xff)
  }
  // fflate's decoder strips a UTF-8 byte-order mark itself, as the encoding
  // spec requires.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    checkUtf8(bytes, 3, true)
    return strFromU8(bytes)
  }

  const label = declaredLabel(bytes)
  const encoding = label?.trim().toLowerCase()
  if (encoding === undefined || UTF8_LABELS.has(encoding) || UTF16_LABELS.has(encoding)) {
    checkUtf8(bytes, 0, encoding !== undefined)
    return strFromU8(bytes)
  }
  if (WINDOWS_1252_LABELS.has(encoding)) return decodeWindows1252(bytes)
  throw new MusicXMLError(
    `The document declares the encoding "${String(label)}", which this converter cannot ` +
      'decode. Save it as UTF-8.',
    { path: [] },
  )
}

// The labels the Encoding Standard gives each encoding read here. It maps
// ISO-8859-1 and US-ASCII to windows-1252, as every browser does.
const UTF8_LABELS: ReadonlySet<string> = new Set([
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'utf-8',
  'utf8',
  'x-unicode20utf8',
])
const WINDOWS_1252_LABELS: ReadonlySet<string> = new Set([
  'ansi_x3.4-1968',
  'ascii',
  'cp1252',
  'cp819',
  'csisolatin1',
  'ibm819',
  'iso-8859-1',
  'iso-ir-100',
  'iso8859-1',
  'iso88591',
  'iso_8859-1',
  'iso_8859-1:1987',
  'l1',
  'latin1',
  'us-ascii',
  'windows-1252',
  'x-cp1252',
])
// A UTF-16 label on a document with no byte-order mark: the declaration read
// as ASCII, so the bytes are not UTF-16. They are read as UTF-8, as an HTML
// parser reads them.
const UTF16_LABELS: ReadonlySet<string> = new Set([
  'csunicode',
  'iso-10646-ucs-2',
  'ucs-2',
  'unicode',
  'unicodefeff',
  'unicodefffe',
  'utf-16',
  'utf-16be',
  'utf-16le',
])

// The declaration must open the document. It is read as ASCII, and its
// whitespace is XML's four characters only.
const DECLARATION = /^<\?xml[ \t\r\n][^>]*?[ \t\r\n]encoding[ \t\r\n]*=[ \t\r\n]*(["'])([^"']*)\1/
const DECLARATION_LENGTH = 256

function declaredLabel(bytes: Uint8Array): string | undefined {
  return DECLARATION.exec(strFromU8(bytes.subarray(0, DECLARATION_LENGTH), true))?.[2]
}

/**
 * Refuses any byte sequence from `start` that UTF-8 does not allow: a stray
 * or missing continuation byte, an overlong form, a surrogate, or a character
 * past U+10FFFF.
 */
function checkUtf8(bytes: Uint8Array, start: number, declared: boolean): void {
  let at = start
  while (at < bytes.length) {
    const lead = bytes[at] as number
    if (lead < 0x80) {
      at++
      continue
    }
    let count: number
    let min: number
    if (lead >= 0xc2 && lead <= 0xdf) {
      count = 1
      min = 0x80
    } else if (lead >= 0xe0 && lead <= 0xef) {
      count = 2
      min = 0x800
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      count = 3
      min = 0x10000
    } else {
      throw invalidUtf8(at, declared)
    }
    let point = lead & (0x3f >> count)
    for (let next = at + 1; next <= at + count; next++) {
      const byte = bytes[next]
      if (byte === undefined || (byte & 0xc0) !== 0x80) throw invalidUtf8(at, declared)
      point = (point << 6) | (byte & 0x3f)
    }
    if (point < min || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      throw invalidUtf8(at, declared)
    }
    at += count + 1
  }
}

function invalidUtf8(at: number, declared: boolean): MusicXMLError {
  return new MusicXMLError(
    declared
      ? `The document is not valid UTF-8 at byte ${String(at)}.`
      : `The document is not valid UTF-8 at byte ${String(at)}, and declares no other encoding.`,
    { path: [] },
  )
}

// Where windows-1252 differs from Latin-1: bytes 0x80 to 0x9f. The five bytes
// windows-1252 leaves undefined keep their Latin-1 control characters, as the
// Encoding Standard decodes them.
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
]

function decodeWindows1252(bytes: Uint8Array): string {
  return strFromU8(bytes, true).replace(/[\x80-\x9f]/g, (character) =>
    String.fromCharCode(WINDOWS_1252_HIGH[character.charCodeAt(0) - 0x80] as number),
  )
}

/** UTF-16 bytes as text, past their byte-order mark. */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) {
    throw new MusicXMLError('The document is UTF-16 but ends in the middle of a character.', {
      path: [],
    })
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
