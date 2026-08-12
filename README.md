# ossia

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the JSON music notation format of
the W3C Music Notation Community Group.

> **Pre-1.0.** MNX has no stable 1.0 release. The output follows a pinned
> snapshot of the spec, and the API can change. Most notation in real song
> repertoire converts (see [What converts](#what-converts)). The converter
> reports everything it cannot convert.

---

## Install

The package is not on the npm registry yet. Until the first release, clone
this repository and build it (see [Development](#development)). After the
first release:

```bash
npm install ossia   # or: pnpm add ossia
```

The library runs in browsers and in Node. The command line needs Node
20.19+, 22.13+, or 24+.

---

## Use

```ts
import { convertMusicXML } from 'ossia'

const { mnx, warnings } = convertMusicXML(musicXmlSource)

console.log(JSON.stringify(mnx, null, 2))

// Each warning is notation that the output does not carry.
for (const w of warnings) {
  console.warn(`${w.code}: ${w.message}`, w.context)
}
```

The source is a `string` or a `Uint8Array` (a Node `Buffer` works). The
bytes can hold an XML document or a compressed `.mxl` package:

```ts
import { readFileSync } from 'node:fs'

const { mnx } = convertMusicXML(readFileSync('song.mxl'))
```

Structurally broken input throws a `MusicXMLError` with the document path and
the source line:

```ts
import { MusicXMLError } from 'ossia'

try {
  convertMusicXML(source)
} catch (e) {
  if (e instanceof MusicXMLError) {
    console.error(e.message, e.path, e.line)
  }
}
```

---

## Warnings

The converter never drops notation silently. When the output cannot carry
something the source states, the conversion continues and reports the loss.
Each entry in `warnings` is a `ConversionWarning`:

| Field       | Contents                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`      | A stable code. The prefix gives the kind of loss (see below).                                                                                       |
| `message`   | A description written for a person.                                                                                                                 |
| `element`   | The MusicXML element the loss is about, without angle brackets. Present when the loss is about one element.                                         |
| `attribute` | The attribute the loss is about, beside its `element`. Present when the loss is about one attribute.                                                |
| `context`   | The location: `part` (the MusicXML part id), `measure` (the source measure number), and `line` (the source line). Each field is present when known. |

An empty `warnings` array means the conversion was lossless as far as the
converter can tell. A pipeline can test for that.

The prefix of `code` gives the kind of loss:

- `unsupported:` marks a gap in this converter. A later release can close it.
  Test for it with `isConverterGap(code)`.
- `unrepresentable:` marks a limit of MNX. No release will close it while the
  output format stays as it is. Test for it with `isFormatLimit(code)`.
- All other prefixes (`inconsistent:`, `missing:`, `unresolved:`, `unclosed:`,
  `redundant:`) mark a problem in the source file. An upgrade does not
  change these.

After an upgrade, reconvert only the files with converter gaps:

```ts
import { isConverterGap } from 'ossia'

const worthRetrying = warnings.some((w) => isConverterGap(w.code))
```

---

## Command line

The package installs an `ossia` command:

```bash
ossia song.mxl                    # writes song.mnx beside it
ossia scores/*.musicxml -o out/   # writes into a directory
ossia *.mxl --fail-on-loss        # exits non-zero if anything is lost
ossia song.mxl --validate --report losses.json
```

The command accepts `.musicxml`, `.xml`, and `.mxl` files. Conversion to MNX
is the default; an explicit `ossia to-mnx song.mxl` does the same thing.
When the command cannot convert a file, it reports the reason and continues
with the other files.

- `--fail-on-loss` exits non-zero when any conversion loses notation.
- `--report <file>` writes the warnings from every file to `<file>` as JSON.
- `--validate` checks every output against the vendored MNX schema.
- `-h` and `-v` print help and version.

The exit code is the pipeline contract:

- `0`: every file converted. With `--fail-on-loss`, no file lost notation.
- `1`: a file did not convert, did not validate, or lost notation under
  `--fail-on-loss`.
- `2`: usage error.

---

## What converts

- Notes, rests, and chords, with pitches, note values, and augmentation dots.
- Several voices in a measure.
- Clefs, including a clef change mid-measure. Key and time signatures.
- Part names, with the short name for later systems.
- Measure numbers that differ from plain 1, 2, 3, so a pickup measure keeps
  its number.
- Tuplets, including nested tuplets.
- Grace notes, gathered into groups that take no measure time.
- Tremolos: on one note as a mark that counts its beams, and across two notes
  as one item that holds the pair, including a pair inside a tuplet.
- Dynamics, from pppppp to ffffff, placed at the cursor point under their
  staff. A sforzando and its family become accent dynamics with their
  combined glyphs. Wording around a mark, such as the "più" of "più f",
  becomes a prefix or suffix. The converter reports a mark outside the MNX
  vocabulary.
- Hairpins, matched end to end across measures and stated once as a gradual
  dynamic that points at the measure where it stops.
- Tempo marks: a metronome mark becomes a tempo on the score. A `<sound>`
  tempo does too, when no metronome beside it states the same thing. An
  `<offset>` moves a mark to the time it belongs to.
- Rolled chords, and the bracket that says a chord is struck together. MNX
  states each once beside the chord, spanning the notes.
- Octave shifts, matched end to end. Both formats keep the sounding pitch on
  the notes, so nothing is transposed.
- Articulations: staccato, tenuto, accent, staccatissimo, spiccato, stress,
  soft accent, and strong accent with its direction. Breath marks with their
  glyphs. Fermatas with their shape and direction.
- Barlines, repeat signs, and first and second endings. MNX states an ending
  as the count of measures it covers.
- Segno signs with their glyphs, Fine, and dal segno jumps. A jump becomes
  D.S. al Fine when a Fine sits on the way back.
- Measure repeats. MNX marks the first measure of each repetition with the
  pattern length. The converter reports a sign with more than one slash.
- Multi-measure rests, stated with their start measure and their count.
- Accidentals. The output declares that accidental display is explicit, and
  the converter marks each accidental the source draws. Cautionary
  accidentals keep their parentheses or brackets.
- Lyrics, verse by verse, with each syllable's place in its word.
- Stem directions.
- Multi-staff parts: a piano part stays one part. Each voice states its
  staff, and a voice that reaches the other staff carries overrides on its
  events.
- Part groups: brackets and braces become nested staff groups. The converter
  reports groups whose edges cross. A part id outside MNX's id pattern is
  renamed to p1, p2, and so on, and reported.
- System and page breaks become pages and systems in the score rendering.
- Instrument names from the part list become the score's sounds. Synthesizer
  setup has no MNX home, and the converter reports it.
- Beams, including secondary beams, hooks, and beams over a grace group,
  built as MNX's tree of beams over the measure.
- Ties and slurs, joined across barlines. The converter reports a tie or
  slur with only one end.
- Exact timing: the converter reads durations as exact fractions of
  `<divisions>` and follows `<backup>` and `<forward>`. A silent gap in a
  voice becomes a space. When a note states no note value, the converter
  recovers it from the duration. A rest that fills its measure keeps no
  invented note value.

**Planned for v1:** free text directions. The pinned spec snapshot has no
place for them yet.

**Reported, never converted:** constructs MNX cannot express, such as pedal
marks and ornaments. These always surface as warnings, never as silent loss.

**Out of scope for v1:** chord symbols and transposing instruments, which
convert with an `unsupported:` warning, and percussion and `score-timewise`
documents, which the converter rejects with a clear error.

**Rejected rather than half-converted:** a tuplet whose extent the source
does not bracket. MusicXML states a tuplet as a ratio on each note and a
bracket around them. Without the bracket, the converter cannot know where
the tuplet ends, so it rejects the file.

---

## Tested against real scores

The converter runs against every file below, with four checks:

1. The file converts.
2. The output validates against the vendored MNX schema.
3. The pitches match the source note for note, per measure and voice.
4. Each measure is as long as the source says.

A file passes all four checks, or the converter refuses it with a stated
reason. The counts are from July 2026; the Lieder corpus keeps growing, and
the weekly gate runs against its latest state.

| Corpus                                                                                                        | Files  | Convert      |
| ------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| [OpenScore Lieder](https://github.com/OpenScore/Lieder) (songs, MuseScore exports)                            | 1,462  | 1,447 (99%)  |
| [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) (exported with MuseScore 3)          | 122    | 112 (92%)    |
| [Unofficial MusicXML Test Suite](https://github.com/cuthbertLab/musicxmlTestSuite) (feature files)            | 150    | 135 (90%)    |
| [MusicXML example set](https://www.musicxml.com/music-in-musicxml/example-set/) (Finale exports, some UTF-16) | 36     | 32 (89%)     |
| [PDMX](https://zenodo.org/records/15571083) random sample (MuseScore.com, all genres)                         | 20,000 | 19,214 (96%) |
| [music21 bundled corpus](https://github.com/cuthbertLab/music21) (hand-encoded, older tools, some UTF-16)     | 654    | 615 (94%)    |
| [CPDL](https://www.cpdl.org) random sample (choral, mostly Sibelius exports)                                  | 2,000  | 1,838 (92%)  |

The rest are refusals, and each names its reason. Some files hold notation
MNX cannot state: percussion and TAB clefs, microtone alterations, and
composite meters such as 3+2/8. Other files disagree with themselves: a
tuplet opened and never closed, a backup that reaches before the measure
start, or a voice that rests through the same measure twice. In the PDMX
sample, the two clef limits account for 580 of the 786 refusals;
MuseScore.com carries much drum and guitar music. In the CPDL sample, the
largest group is hymnals that write two lines over each other in one voice;
the converter refuses these rather than guess them apart.

The test suite converts 600 vendored Lieder songs on every run, and CI runs
the full Lieder corpus weekly and on demand.

---

## Safe on untrusted input

Most MusicXML files carry a DOCTYPE that points at an external DTD URL. The
XML layer never resolves external entities and never processes DTDs. XXE and
entity-expansion ("billion laughs") attacks do not apply.

---

## MNX spec pinning

MNX is a moving draft. Each release pins one
[w3c/mnx](https://github.com/w3c/mnx) commit. The schema is vendored at
`schema/mnx-schema.json`, with its source commit and checksum recorded in
[`schema/PROVENANCE.md`](schema/PROVENANCE.md). The test suite validates
every conversion against the schema.

---

## Development

```bash
pnpm install
pnpm hooks:install   # once per clone: enables the pre-commit gate

pnpm test            # pnpm test:coverage enforces the ≥98% thresholds
pnpm typecheck
pnpm lint
pnpm build

pnpm bench           # times each pipeline stage and whole conversions
```

See [docs/architecture.md](docs/architecture.md) for how the converter is put
together and why, and [AGENTS.md](AGENTS.md) for the working conventions.

---

## License

MIT
