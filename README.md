# ossia

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the JSON music notation format from
the W3C Music Notation Community Group.

ossia is a TypeScript library for browsers and Node, with a Node command-line
interface. It reads XML documents and compressed `.mxl` files.

**Pre-1.0:** MNX is a draft. Output follows a pinned schema snapshot.
The API and output types can change.

## Install

```bash
npm install ossia
```

The package supports Node `^20.19.0 || ^22.13.0 || >=24`.
The library also runs in browsers.

## Use

```ts
import { convertMusicXML } from 'ossia'

const { mnx, warnings } = convertMusicXML(musicXmlSource)

console.log(JSON.stringify(mnx, null, 2))

for (const warning of warnings) {
  console.warn(`${warning.code}: ${warning.message}`, warning.context)
}
```

Pass XML as a `string`, or pass file bytes as a `Uint8Array`.
A Node `Buffer` is also accepted:

```ts
import { readFileSync } from 'node:fs'
import { convertMusicXML } from 'ossia'

const { mnx, warnings } = convertMusicXML(readFileSync('song.mxl'))
```

Byte input can contain UTF-8 XML, UTF-16 XML with a byte-order mark, XML that
declares ISO-8859-1 or windows-1252, or an `.mxl` archive. Other declared
encodings, and a document read as UTF-8 that is not valid UTF-8, throw a
`MusicXMLError`.

Use `scoreName` to name the MNX score rendering. Its default is `"Score"`.
Use `documentName` to identify the source in error messages:

```ts
const { mnx, warnings } = convertMusicXML(source, {
  scoreName: 'Erlkönig',
  documentName: 'Erlkönig.mxl',
})
```

Conversion is synchronous and processes the whole document in memory.
It returns no partial result when it throws.

## Errors and warnings

Malformed input and unsupported score structures can cause a `MusicXMLError`.
For example, the converter rejects `score-timewise` documents.

```ts
import { convertMusicXML, MusicXMLError } from 'ossia'

try {
  const result = convertMusicXML(source)
  console.log(result.mnx)
} catch (error) {
  if (!(error instanceof MusicXMLError)) throw error
  console.error(error.message, error.path, error.line)
}
```

`path` contains document path segments. `line` is present when known.
`detail` contains the error message without its location.

When conversion can continue, warnings report omitted notation and source
problems. Silent notation loss is a bug.

Each `ConversionWarning` has these fields:

| Field       | Contents                                                          |
| ----------- | ----------------------------------------------------------------- |
| `code`      | A stable warning code.                                            |
| `message`   | A description of the problem.                                     |
| `element`   | The affected MusicXML element, when applicable.                   |
| `attribute` | The affected attribute, when applicable.                          |
| `context`   | Part ID, one-based measure position, and source line, when known. |

The measure position counts measures within the part. A pickup labelled `0`
can therefore have warning position `1`.

Warning prefixes identify three categories:

| Prefix                                                                | Meaning                                    | Helper                  |
| --------------------------------------------------------------------- | ------------------------------------------ | ----------------------- |
| `unsupported:`                                                        | A gap in the converter.                    | `isConverterGap(code)`  |
| `unrepresentable:`                                                    | A limitation of the pinned MNX format.     | `isFormatLimit(code)`   |
| `inconsistent:`, `missing:`, `unresolved:`, `unclosed:`, `redundant:` | A source problem or a reported correction. | `isSourceProblem(code)` |

An empty warning array means no loss was detected.
It is not an independent proof that the output preserves every source detail.

Converter gaps can help prioritize files for another conversion:

```ts
import { isConverterGap } from 'ossia'

const hasConverterGap = warnings.some((warning) => isConverterGap(warning.code))
```

Bug fixes can also change other warnings or resolve earlier refusals.
Review release changes before choosing which files to convert again.

For comparisons between runs, use `code`, `element`, and `attribute` together.
Generic codes such as `unsupported:element` cover more than one kind of notation.

## Command line

The package provides an `ossia` command. With a local installation, use
`npx ossia` or `pnpm exec ossia`:

```bash
npx ossia song.mxl
npx ossia scores/*.musicxml -o out/
npx ossia song.mxl --validate --report losses.json
npx ossia scores/*.mxl --fail-on-loss
```

The command reads `.musicxml`, `.xml`, and `.mxl` files.
It writes `<basename>.mnx` beside each input, or into the directory set by `-o`.
`ossia to-mnx` is equivalent to `ossia`.

| Option                    | Effect                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `-o`, `--out <directory>` | Select the output directory.                                     |
| `--validate`              | Check output against the vendored MNX schema.                    |
| `--report <file>`         | Write warnings for converted files as JSON, keyed by input path. |
| `--fail-on-loss`          | Exit with code 1 if any conversion reports warnings.             |
| `-h`, `--help`            | Print help.                                                      |
| `-v`, `--version`         | Print the version.                                               |

Input-read and conversion errors are reported per file. Processing then
continues with the remaining inputs. Output-write and report-write errors
can stop the batch before it finishes.

| Exit code | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `0`       | All files converted. With `--fail-on-loss`, none reported warnings.      |
| `1`       | A file failed, validation failed, or `--fail-on-loss` detected warnings. |
| `2`       | Command usage error.                                                     |

The report contains warnings, not a complete failure log.
Check the exit code and command output as well.

## What converts

Support includes the following notation. Some forms require warnings or
cause the converter to reject a document.

| Area                 | Supported notation                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Notes and rhythm     | Notes, rests, chords, dots, multiple voices, tuplets, nested tuplets, grace groups, and tremolos.             |
| Staff notation       | Clefs and clef changes, staff line counts, key signatures, time signatures, accidentals, and stem directions. |
| Connections          | Beams, secondary beams, hooks, ties, slurs, and octave shifts.                                                |
| Expression           | Dynamics, hairpins, metronome marks, articulations, bow marks, breath marks, fermatas, and rolled chords.     |
| Structure            | Barlines, repeats, endings, segno signs, Fine, dal segno jumps, measure repeats, and multi-measure rests.     |
| Parts and layout     | Part names, staff groups, multiple staves, cross-staff events, system breaks, and page breaks.                |
| Instruments and text | Transposing instruments, instrument names, percussion kits, and lyrics by verse.                              |

Durations use exact fractions. The reader follows MusicXML's `<backup>` and
`<forward>` cursor movements. Gaps in a voice become MNX spaces.

Important limits include:

- Free text directions, pedal marks, and unsupported ornaments produce warnings.
- Chord symbols are not converted and produce `unsupported:` warnings.
- Playback-only `<sound>` tempo is omitted with a warning unless a matching metronome mark already carries it.
- Transposition changes within a part and differing staff transpositions produce warnings.
- Grace-note time amounts produce warnings. Grace notes with an unbracketed tuplet ratio cause a refusal.
- Composite meters such as `3+2/8` cause a refusal.

Use warnings to assess the result for a particular score.

## Testing with real scores

The corpus tests check schema validity, pitches by measure and voice, and
measure lengths against the source. They distinguish conversion refusals
from crashes and failed output checks.

For files with `inconsistent:duration`, the tests skip the measure-length
comparison. These files retain written note values that differ from source
durations. Schema and pitch checks still run.

These comparisons run in the test suite. The library does not run them
during conversion. The CLI's `--validate` option checks schema validity only.

The following are previously recorded results, not results from a fresh run.
Counts are from September 2026, except String Quartets, which is from July 2026.
A converted file can still have warnings.

| Corpus                                                                                        | Files  | Converted |
| --------------------------------------------------------------------------------------------- | ------ | --------- |
| [OpenScore Lieder](https://github.com/OpenScore/Lieder)                                       | 1,462  | 1,462     |
| [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets), MuseScore 3 exports | 122    | 112       |
| [Unofficial MusicXML Test Suite](https://github.com/cuthbertLab/musicxmlTestSuite)            | 150    | 144       |
| [MusicXML example set](https://www.musicxml.com/music-in-musicxml/example-set/)               | 36     | 34        |
| [PDMX](https://zenodo.org/records/15571083), random sample                                    | 20,000 | 19,985    |
| [music21 bundled corpus](https://github.com/cuthbertLab/music21)                              | 654    | 646       |
| [CPDL](https://www.cpdl.org), random sample                                                   | 2,000  | 1,985     |

The regular suite includes 600 vendored Lieder songs and seven feature files.
CI runs the full Lieder corpus weekly and on demand against its latest state.
See the [corpus source notes](tests/corpus/PROVENANCE.md) for selection and licensing details.

## Input handling

The XML parser does not resolve external entities or process DTDs.
Undefined entities cause parse errors.

The converter limits raw input length and selected archive entries to
`100 * 1024 * 1024`. Raw byte input and declared archive sizes are measured
in bytes. String input is measured in UTF-16 code units.

Archive extraction reads the container listing and the score it identifies.
If the listing does not identify an existing entry, a single XML score file
can be used instead.
Conversion still requires memory for the XML tree, internal model, and output.

## MNX schema

Output types target the vendored schema at `schema/mnx-schema.json`.
The [schema source notes](schema/PROVENANCE.md) record its commit and checksum.

Every conversion output in tests must validate against that schema.
The package exports the MNX output types, including `MNXDocument`.
A schema update can change these types and the generated output.

## Development

Use Node 24, as specified in `.nvmrc`, and the pnpm version pinned in `package.json`.

```bash
pnpm install
pnpm hooks:install
pnpm typecheck
pnpm lint
pnpm deps:check
pnpm format:check
pnpm test:coverage
pnpm build
```

`pnpm test:coverage` enforces 98% coverage thresholds.
`pnpm bench` measures pipeline stages and complete conversions.

Read the [architecture](docs/architecture.md) and [working conventions](AGENTS.md)
before changing the converter.

## License

[MIT](LICENSE). Vendored scores and schema have separate source and license notes linked above.
