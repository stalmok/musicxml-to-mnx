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
})
