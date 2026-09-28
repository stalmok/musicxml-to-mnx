// Run with `pnpm bench`. Three groups:
//   1. each pipeline stage on the same mid-sized song
//   2. whole conversions of real songs, smallest to largest
//   3. whole conversions of generated scores larger than the corpus
//
// The pass/fail complexity guards are in performance.test.ts.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bench, describe } from 'vitest'
import { readMusicXML } from '../src/container.js'
import { convertMusicXML } from '../src/index.js'
import { readScore } from '../src/read/score.js'
import { WarningCollector } from '../src/warnings.js'
import { writeMnx } from '../src/write/mnx.js'
import { parseXmlRoot } from '../src/xml/parse.js'
import { generateScore } from './support/generate.js'
import { songs } from './support/corpus.js'

// Picks songs by size so that no file name is hard-coded.
const bySize = songs().sort((a, b) => a.source.length - b.source.length)
const smallest = bySize.at(0)
const median = bySize.at(Math.floor(bySize.length / 2))
const largest = bySize.at(-1)
if (!smallest || !median || !largest) throw new Error('corpus is empty')

describe('pipeline stages', () => {
  const mxlBytes = new Uint8Array(
    readFileSync(join(fileURLToPath(new URL('./corpus', import.meta.url)), `${median.name}.mxl`)),
  )
  const tree = parseXmlRoot(median.source)
  const score = readScore(tree, new WarningCollector())

  bench('unpack .mxl', () => {
    readMusicXML(mxlBytes)
  })

  bench('parse xml', () => {
    parseXmlRoot(median.source)
  })

  bench('read score', () => {
    readScore(tree, new WarningCollector())
  })

  bench('write mnx', () => {
    writeMnx(score)
  })
})

describe('corpus songs', () => {
  for (const song of [smallest, median, largest]) {
    bench(`${song.name} (${Math.round(song.source.length / 1024)} KiB)`, () => {
      convertMusicXML(song.source)
    })
  }
})

describe('generated scores', () => {
  const sizes = [
    { parts: 1, measures: 100, notesPerMeasure: 8 },
    { parts: 4, measures: 250, notesPerMeasure: 8 },
    { parts: 4, measures: 1000, notesPerMeasure: 8 },
  ] as const
  for (const size of sizes) {
    const source = generateScore(size)
    bench(`${size.parts} parts x ${size.measures} measures x ${size.notesPerMeasure} notes`, () => {
      convertMusicXML(source)
    })
  }
})
