// Getting the MusicXML out of a string, raw bytes, or an .mxl package.

import { describe, expect, test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MusicXMLError } from './errors.js'
import { readMusicXML } from './container.js'

const SCORE = '<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>'

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

/**
 * A one-entry zip whose declared uncompressed size is forged to `size`, its
 * data left tiny. A decompression bomb is only dangerous for the size it
 * claims, and the reader refuses it on that claim before inflating anything,
 * so forging the claim tests the guard without a 100 MB allocation. Both the
 * uncompressed-size fields a zip carries — in the local header after
 * `PK\x03\x04` and in the central directory after `PK\x01\x02` — are set.
 */
function withForgedSize(name: string, content: string, size: number): Uint8Array {
  const zip = zipSync({ [name]: strToU8(content) })
  writeSize(zip, [0x50, 0x4b, 0x03, 0x04], 22, size)
  writeSize(zip, [0x50, 0x4b, 0x01, 0x02], 24, size)
  return zip
}

function writeSize(zip: Uint8Array, signature: number[], fieldOffset: number, size: number): void {
  const at = indexOf(zip, signature) + fieldOffset
  for (let i = 0; i < 4; i++) zip[at + i] = (size >>> (i * 8)) & 0xff
}

function indexOf(bytes: Uint8Array, signature: number[]): number {
  for (let i = 0; i + signature.length <= bytes.length; i++) {
    if (signature.every((byte, j) => bytes[i + j] === byte)) return i
  }
  throw new Error('signature not found')
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
    const archive = withForgedSize('big.musicxml', SCORE, 100 * 1024 * 1024 + 1)

    let thrown: unknown
    try {
      readMusicXML(archive)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).message).toContain('over the')
  })

  test('falls back to the only score where the container carries no rootfiles', () => {
    const archive = mxl({
      'META-INF/container.xml': '<container></container>',
      'score.musicxml': SCORE,
    })

    expect(readMusicXML(archive)).toBe(SCORE)
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
