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
  // neither order, is read as UTF-8, where neither byte is valid.
  test.each([
    ['a first byte of 0xff alone', [0xff, 0x3c, 0x78, 0x2f, 0x3e], 0],
    ['a first byte of 0xfe alone', [0xfe, 0x3c, 0x78, 0x2f, 0x3e], 0],
    ['a second byte of 0xfe alone', [0x3c, 0xfe, 0x78, 0x2f, 0x3e], 1],
    ['a second byte of 0xff alone', [0x3c, 0xff, 0x78, 0x2f, 0x3e], 1],
  ])('refuses %s as UTF-8', (_name, bytes, at) => {
    expect(() => readMusicXML(new Uint8Array(bytes))).toThrow(
      `The document is not valid UTF-8 at byte ${String(at)}, and declares no other encoding.`,
    )
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

describe('the encoding a document declares', () => {
  function declared(encoding: string, body: number[], quote = '"'): Uint8Array {
    const head = `<?xml version="1.0" encoding=${quote}${encoding}${quote}?><x>`
    return new Uint8Array([...strToU8(head), ...body, ...strToU8('</x>')])
  }

  function refusal(bytes: Uint8Array): MusicXMLError {
    let thrown: unknown
    try {
      readMusicXML(bytes)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).path).toEqual([])
    return thrown as MusicXMLError
  }

  test.each(['ISO-8859-1', 'iso-8859-1', 'latin1', 'windows-1252', 'CP1252', 'US-ASCII'])(
    'decodes %s one byte per character',
    (encoding) => {
      expect(readMusicXML(declared(encoding, [0x65, 0x74, 0xe9]))).toContain('<x>eté</x>')
    },
  )

  // ISO-8859-1 labels are read as windows-1252, as the Encoding Standard reads
  // them. It differs from Latin-1 only at bytes 0x80 to 0x9f, stated here from
  // the standard's index. TextDecoder is no oracle: Node before 23 decodes
  // windows-1252 as Latin-1.
  test('reads every byte of ISO-8859-1 as windows-1252 does', () => {
    const every = Array.from({ length: 256 }, (_, byte) => byte)
    const high = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ'
    const expected =
      String.fromCharCode(...every.slice(0, 0x80)) +
      high +
      String.fromCharCode(...every.slice(0xa0))

    expect(high).toHaveLength(32)
    expect(readMusicXML(declared('ISO-8859-1', every))).toContain(`<x>${expected}</x>`)
  })

  test('reads a label in single quotes', () => {
    expect(readMusicXML(declared('ISO-8859-1', [0xe9], "'"))).toContain('<x>é</x>')
  })

  test('reads a label with space around the equals sign', () => {
    const head = strToU8('<?xml version="1.0" encoding = "ISO-8859-1"?><x>')
    expect(readMusicXML(new Uint8Array([...head, 0xe9]))).toContain('<x>é')
  })

  test.each(['UTF-8', 'utf-8', 'UTF8', ' utf-8 '])('decodes %s as UTF-8', (encoding) => {
    expect(readMusicXML(declared(encoding, [0xc3, 0xa9]))).toContain('<x>é</x>')
  })

  // A byte-order mark outranks the declaration, as the XML specification
  // orders them.
  test('follows a UTF-8 byte-order mark over the declaration', () => {
    const bytes = declared('ISO-8859-1', [0xc3, 0xa9])
    expect(readMusicXML(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toContain('<x>é</x>')
  })

  test('decodes the score of an .mxl package by its declaration', () => {
    const archive = zipSync({ 'score.musicxml': declared('ISO-8859-1', [0xe9]) })
    expect(readMusicXML(archive)).toContain('<x>é</x>')
  })

  // A declaration readable as ASCII rules out UTF-16.
  test.each(['UTF-16', 'utf-16le'])('reads %s with no byte-order mark as UTF-8', (encoding) => {
    expect(readMusicXML(declared(encoding, [0xc3, 0xa9]))).toContain('<x>é</x>')
  })

  // An encoding word outside the declaration is ordinary text.
  test('ignores an encoding named after the declaration', () => {
    const text = '<?xml version="1.0"?><x encoding="ISO-8859-1">é</x>'
    expect(readMusicXML(strToU8(text))).toBe(text)
  })

  test('ignores a declaration that does not open the document', () => {
    const bytes = new Uint8Array([...strToU8(' '), ...declared('ISO-8859-1', [0xe9])])
    expect(refusal(bytes).detail).toBe(
      'The document is not valid UTF-8 at byte 47, and declares no other encoding.',
    )
  })

  // XML whitespace is four characters. A no-break space is not one of them.
  test('ignores a declaration separated by a no-break space', () => {
    const head = strToU8('<?xml version="1.0"')
    const tail = strToU8('encoding="ISO-8859-1"?><x/>')
    expect(refusal(new Uint8Array([...head, 0xa0, ...tail])).detail).toBe(
      'The document is not valid UTF-8 at byte 19, and declares no other encoding.',
    )
  })

  test('refuses a package listing that is not valid UTF-8', () => {
    const listing = new Uint8Array([...strToU8(container('score.musicxml')), 0xe9])
    const archive = zipSync({ 'META-INF/container.xml': listing, 'score.musicxml': strToU8(SCORE) })
    expect(refusal(archive).detail).toContain('not valid UTF-8')
  })

  test.each(['Shift_JIS', 'ISO-8859-2', ''])('refuses %s, which it cannot decode', (encoding) => {
    const error = refusal(declared(encoding, [0x41]))
    expect(error.detail).toContain(`"${encoding}"`)
  })

  test('names a label as its bytes read in Latin-1', () => {
    const head = strToU8('<?xml version="1.0" encoding="')
    const bytes = new Uint8Array([...head, 0xe9, ...strToU8('"?><x/>')])
    expect(refusal(bytes).detail).toContain('"é"')
  })

  test('refuses bytes that are not the UTF-8 they declare', () => {
    expect(refusal(declared('UTF-8', [0xe9])).detail).toBe(
      'The document is not valid UTF-8 at byte 41.',
    )
  })

  test('counts a byte past the byte-order mark from the start of the file', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...declared('ISO-8859-1', [0xe9])])
    expect(refusal(bytes).detail).toBe('The document is not valid UTF-8 at byte 49.')
  })

  test('leaves a string alone whatever it declares', () => {
    const text = '<?xml version="1.0" encoding="Shift_JIS"?><x>é</x>'
    expect(readMusicXML(text)).toBe(text)
  })
})

describe('a UTF-8 document', () => {
  test('keeps characters of two, three and four bytes', () => {
    const text = '<x>é–𝄞</x>'
    expect(readMusicXML(strToU8(text))).toBe(text)
  })

  test('keeps the highest and lowest characters of each length', () => {
    const text = '<x>\u0000\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}</x>'
    expect(readMusicXML(strToU8(text))).toBe(text)
  })

  // Each of these begins with some but not all of the byte-order mark's three
  // bytes, so none is a mark to strip.
  test.each([
    ['U+0EFF', '\u0eff'],
    ['U+F0BF', '\uf0bf'],
    ['U+FEC0', '\ufec0'],
    ['"<¿"', '<¿'],
  ])('keeps a first character %s that shares bytes with the byte-order mark', (_name, first) => {
    expect(readMusicXML(strToU8(`${first}<x/>`))).toBe(`${first}<x/>`)
  })

  test.each([
    ['EF BB 41', [0xef, 0xbb, 0x41], 0],
    ['EF 41 BF', [0xef, 0x41, 0xbf], 0],
    ['41 BB BF', [0x41, 0xbb, 0xbf], 1],
  ])('refuses %s, which is only part of a byte-order mark', (_name, head, at) => {
    expect(() => readMusicXML(new Uint8Array([...head, ...strToU8('<x/>')]))).toThrow(
      `The document is not valid UTF-8 at byte ${String(at)}, and declares no other encoding.`,
    )
  })

  // A Latin-1 file with no declaration: its accented letters are not UTF-8.
  test.each([
    ['a Latin-1 letter', [0xe9, 0x74, 0xe9]],
    ['a lone continuation byte', [0x80]],
    ['a lead byte at the end', [0xc3]],
    ['a three-byte character cut short', [0xe2, 0x80]],
    ['a lead byte followed by a non-continuation', [0xc3, 0x41]],
    ['an overlong two-byte form', [0xc0, 0x80]],
    ['an overlong three-byte form', [0xe0, 0x80, 0x80]],
    ['an overlong four-byte form', [0xf0, 0x80, 0x80, 0x80]],
    ['a surrogate', [0xed, 0xa0, 0x80]],
    ['the last surrogate', [0xed, 0xbf, 0xbf]],
    ['two continuation bytes', [0xbf, 0xbf]],
    ['three continuation bytes', [0x8f, 0xbf, 0xbf]],
    ['four continuation bytes', [0x81, 0x90, 0x80, 0x80]],
    ['a character past U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ['a five-byte lead', [0xf8, 0x80, 0x80, 0x80]],
    ['a six-byte lead', [0xfc, 0x80, 0x80, 0x80]],
  ])('refuses %s', (_name, body) => {
    const bytes = new Uint8Array([...strToU8('<x>'), ...body, ...strToU8('</x>')])
    let thrown: unknown
    try {
      readMusicXML(bytes)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MusicXMLError)
    expect((thrown as MusicXMLError).detail).toBe(
      'The document is not valid UTF-8 at byte 3, and declares no other encoding.',
    )
  })

  // Node's strict decoder follows the Unicode rules, so it checks the refusals
  // over random bytes drawn from the ranges multi-byte characters use.
  test('refuses exactly what a strict decoder refuses', () => {
    const strict = new TextDecoder('utf-8', { fatal: true })
    const pool = [0x3c, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf]
    pool.push(0xe0, 0xed, 0xee, 0xef, 0xf0, 0xf4, 0xf5, 0xff)
    let seed = 1
    for (let run = 0; run < 20000; run++) {
      const bytes = Uint8Array.from({ length: 1 + (run % 6) }, () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        return pool[seed % pool.length] as number
      })
      let expected: string | undefined
      try {
        expected = strict.decode(bytes)
      } catch {
        expected = undefined
      }
      const decode = (): string => readMusicXML(new Uint8Array([0x3c, ...bytes]))
      if (expected === undefined) expect(decode).toThrow(MusicXMLError)
      else expect(decode()).toBe(`<${expected}`)
    }
  })
})
