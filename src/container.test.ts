// Getting the MusicXML out of a string, raw bytes, or an .mxl package.

import { describe, expect, test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MusicXMLError } from './errors.js'
import { readMusicXML } from './container.js'

const SCORE = '<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>'

// The size a document, or any one entry of a package, may decompress to.
const LIMIT = 100 * 1024 * 1024

function container(...rootfiles: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
    rootfiles.map((path) => `<rootfile full-path="${path}"/>`).join('') +
    '</rootfiles></container>'
  )
}

function mxl(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text)
  return zipSync(entries)
}

// Where a zip states an entry's uncompressed size and its compression method:
// once in the local header before the entry's data, once in the central
// directory at the end of the file. Both carry the entry's name, so either is
// found by scanning for its signature and then the name inside it.
const LOCAL = { signature: [0x50, 0x4b, 0x03, 0x04], nameAt: 30, sizeAt: 22, methodAt: 8 }
const CENTRAL = { signature: [0x50, 0x4b, 0x01, 0x02], nameAt: 46, sizeAt: 24, methodAt: 10 }

/**
 * The zip with one entry's declared uncompressed size forged to `size`, its
 * data left tiny. A decompression bomb is only dangerous for the size it
 * claims, and the reader refuses it on that claim before inflating anything,
 * so forging the claim tests the guard without a 100 MB allocation.
 */
function withForgedSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const field = Uint8Array.from([0, 8, 16, 24], (shift) => (size >>> shift) & 0xff)
  for (const header of [LOCAL, CENTRAL]) zip.set(field, headerOf(zip, header, name) + header.sizeAt)
  return zip
}

/** The zip with one entry's compression method forged to one no reader knows. */
function withUnreadableEntry(zip: Uint8Array, name: string): Uint8Array {
  const unknown = Uint8Array.of(99, 0)
  for (const header of [LOCAL, CENTRAL]) {
    zip.set(unknown, headerOf(zip, header, name) + header.methodAt)
  }
  return zip
}

function headerOf(zip: Uint8Array, header: typeof LOCAL, name: string): number {
  const wanted = strToU8(name)
  for (let at = 0; at + header.nameAt + wanted.length <= zip.length; at++) {
    if (!header.signature.every((byte, index) => zip[at + index] === byte)) continue
    if (wanted.every((byte, index) => zip[at + header.nameAt + index] === byte)) return at
  }
  throw new Error(`no header for ${name}`)
}

describe('a string', () => {
  test('is the document itself, and passes through untouched', () => {
    expect(readMusicXML(SCORE)).toBe(SCORE)
  })
})

describe('raw bytes', () => {
  test('are decoded as UTF-8', () => {
    // A character above the ASCII range, to prove it is decoded, not sliced.
    const withAccent = SCORE.replace('P1', 'Pä')
    expect(readMusicXML(strToU8(withAccent))).toBe(withAccent)
  })

  test('have a leading byte-order mark stripped', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(SCORE)])

    expect(readMusicXML(bom)).toBe(SCORE)
  })
})

describe('an .mxl package', () => {
  test('reads the score its container names', () => {
    const archive = mxl({
      'META-INF/container.xml': container('score.musicxml'),
      'score.musicxml': SCORE,
    })

    expect(readMusicXML(archive)).toBe(SCORE)
  })

  test('takes the first rootfile where the container names several', () => {
    const archive = mxl({
      'META-INF/container.xml': container('first.musicxml', 'second.musicxml'),
      'first.musicxml': SCORE,
      'second.musicxml': SCORE.replace('P1', 'P2'),
    })

    expect(readMusicXML(archive)).toContain('P1')
  })

  // A real package always lists its score, but an exporter that omits the
  // listing still leaves exactly one score to read.
  test('falls back to the only score where there is no container', () => {
    expect(readMusicXML(mxl({ 'score.musicxml': SCORE }))).toBe(SCORE)
  })

  test('falls back to the only score where the container names a missing one', () => {
    const archive = mxl({
      'META-INF/container.xml': container('gone.musicxml'),
      'score.musicxml': SCORE,
    })

    expect(readMusicXML(archive)).toBe(SCORE)
  })

  test('accepts a score with an .xml extension', () => {
    expect(readMusicXML(mxl({ 'score.xml': SCORE }))).toBe(SCORE)
  })

  test('refuses a package that holds no score', () => {
    let thrown: unknown
    try {
      readMusicXML(mxl({ 'META-INF/manifest.txt': 'nothing here' }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('no META-INF/container.xml')
  })

  test('refuses a package that names a score it does not contain and holds several', () => {
    const archive = mxl({
      'META-INF/container.xml': container('gone.musicxml'),
      'one.musicxml': SCORE,
      'two.musicxml': SCORE,
    })

    let thrown: unknown
    try {
      readMusicXML(archive)
    } catch (error) {
      thrown = error
    }

    expect((thrown as MusicXMLError).message).toContain('does not contain it')
  })

  test('refuses bytes that begin like a zip but are not one', () => {
    // The signature, then garbage, so the unzip itself fails.
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0])

    let thrown: unknown
    try {
      readMusicXML(broken)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('could not be unzipped')
  })

  // A score that is itself a decompression bomb is refused by its declared
  // size before it inflates. The declaration is forged rather than a real
  // 100 MB entry, so the test is light: the point is that the size is checked
  // before anything is decompressed, which is exactly what forging it proves.
  test('refuses a score that decompresses past the limit', () => {
    const archive = withForgedSize(mxl({ 'big.musicxml': SCORE }), 'big.musicxml', LIMIT + 1)

    let thrown: unknown
    try {
      readMusicXML(archive)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('over the')
  })

  // Raw input carries no per-entry size field to check, so its own length is
  // the bound. Without it the zip path is capped and the raw path is not.
  test('refuses raw bytes past the limit', () => {
    const huge = new Uint8Array(LIMIT + 1)

    let thrown: unknown
    try {
      readMusicXML(huge)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('over the')
  })

  // The limit is a limit, not a bound: a document exactly that long is read.
  test('accepts a document exactly at the limit', () => {
    expect(readMusicXML('a'.repeat(LIMIT))).toHaveLength(LIMIT)
  })

  // Bytes beginning "PK" are not a package unless the whole signature is
  // there, and the rest of a zip's magic number is not printable text.
  test('reads bytes that begin like a zip signature but are text as text', () => {
    const text = `PK${SCORE}`

    expect(readMusicXML(strToU8(text))).toBe(text)
  })

  // The listing and the one score it names are decompressed; every other
  // entry stays packed, so an entry nothing can decompress is no obstacle,
  // and a bomb hidden beside the score is never inflated.
  test('leaves every other entry in a package packed', () => {
    const archive = withUnreadableEntry(
      mxl({
        'META-INF/container.xml': container('score.musicxml'),
        'score.musicxml': SCORE,
        'cover.png': 'x'.repeat(200),
      }),
      'cover.png',
    )

    expect(readMusicXML(archive)).toBe(SCORE)
  })

  test('accepts an entry declaring exactly the limit', () => {
    const archive = withForgedSize(mxl({ 'score.musicxml': SCORE }), 'score.musicxml', LIMIT)

    expect(readMusicXML(archive)).toBe(SCORE)
  })

  test('falls back to the only score where the container carries no rootfiles', () => {
    const archive = mxl({
      'META-INF/container.xml': '<container></container>',
      'score.musicxml': SCORE,
    })

    expect(readMusicXML(archive)).toBe(SCORE)
  })
})

// Each of these refusals is of the document or the package as a whole: there
// is no element inside it to name, and stating the empty path is what makes
// that a decision rather than an omission.
describe('a refusal with no place inside the document', () => {
  test.each([
    ['bytes past the limit', () => new Uint8Array(LIMIT + 1)],
    ['a package holding no score', () => mxl({ 'META-INF/manifest.txt': 'nothing here' })],
    [
      'bytes that begin like a zip but are not one',
      () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]),
    ],
    [
      'an entry declaring more than the limit',
      () => withForgedSize(mxl({ 'big.musicxml': SCORE }), 'big.musicxml', LIMIT + 1),
    ],
    ['a UTF-16 document cut short', () => new Uint8Array([0xff, 0xfe, 0x3c])],
  ])('names none for %s', (_name, source) => {
    let thrown: unknown
    try {
      readMusicXML(source())
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).path).toEqual([])
  })
})

// Finale ships UTF-16 MusicXML, so a byte-order mark means decoding it, not
// refusing it.
describe('a UTF-16 document', () => {
  function utf16(text: string, littleEndian: boolean): Uint8Array {
    const bytes = new Uint8Array(2 + text.length * 2)
    ;[bytes[0], bytes[1]] = littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i)
      bytes[2 + i * 2] = littleEndian ? unit & 0xff : unit >> 8
      bytes[3 + i * 2] = littleEndian ? unit >> 8 : unit & 0xff
    }
    return bytes
  }

  test.each([
    ['little-endian', true],
    ['big-endian', false],
  ])('decodes %s UTF-16 by its byte-order mark', (_name, littleEndian) => {
    expect(readMusicXML(utf16(SCORE, littleEndian))).toBe(SCORE)
  })

  // A character outside the basic plane is two units in both encodings, and
  // must survive the pairing.
  test('keeps a character written as a surrogate pair', () => {
    expect(readMusicXML(utf16('<x>𝄞</x>', true))).toBe('<x>𝄞</x>')
  })

  // Half a mark is no mark: one byte of a pair, or the two bytes of a pair in
  // neither order, is a UTF-8 document. Each case is an odd number of bytes,
  // which UTF-16 would refuse, so reading it at all says which branch ran.
  test.each([
    ['a first byte of 0xff alone', [0xff, 0x3c, 0x78, 0x2f, 0x3e]],
    ['a first byte of 0xfe alone', [0xfe, 0x3c, 0x78, 0x2f, 0x3e]],
    ['a second byte of 0xfe alone', [0x3c, 0xfe, 0x78, 0x2f, 0x3e]],
    ['a second byte of 0xff alone', [0x3c, 0xff, 0x78, 0x2f, 0x3e]],
  ])('decodes %s as UTF-8', (_name, bytes) => {
    expect(readMusicXML(new Uint8Array(bytes))).toContain('x/>')
  })

  test('refuses a document ending in the middle of a character', () => {
    let thrown: unknown
    try {
      readMusicXML(new Uint8Array([0xff, 0xfe, 0x3c]))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('UTF-16')
  })
})
