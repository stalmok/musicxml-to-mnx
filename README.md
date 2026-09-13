# ossia

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the JSON music notation format of
the W3C Music Notation Community Group.

> **Pre-1.0.** MNX has no stable 1.0 release. The output agrees with a pinned
> snapshot of the spec, and the API can change. Most notation in real song
> repertoire converts. See [What converts](#what-converts). The converter
> reports all notation that it cannot convert.

---

## Install

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

The source is a `string` or a `Uint8Array`. A Node `Buffer` is also correct.
The bytes can hold an XML document or a compressed `.mxl` package:

```ts
import { readFileSync } from 'node:fs'

const { mnx } = convertMusicXML(readFileSync('song.mxl'))
```

MNX asks a score rendering to be named, and MusicXML has no name for one: a
work's title names the work, not a rendering of it. Give the name yourself
where the output states a rendering. The default is "Score".

```ts
const { mnx } = convertMusicXML(source, { scoreName: 'Erlkönig' })
```

If the input has a broken structure, the converter throws a `MusicXMLError`.
The error gives the document path and the source line:

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

A source is text or bytes, so the converter cannot know which file it came
from. Name it if you convert more than one, and the error says which:

```ts
convertMusicXML(source, { documentName: 'Erlkönig.mxl' })
// MusicXMLError: Unknown pitch step "H".
//   (in Erlkönig.mxl, at score-partwise > part P1 > measure 1, line 5)
```

`e.detail` gives the same message without the location, which is what to
compare if you group refusals: the location moves whenever a file is
re-exported.

The whole document is converted at once. There is no streaming and no partial
result: the source is parsed into a whole tree, the tree read into a whole
model, and the model written as a whole document. This is not a limit for a
song; it is one for a large orchestral score.

---

## Warnings

The converter never drops notation silently. If the output cannot carry
something that the source states, the conversion continues and the converter
reports the loss. Each item in `warnings` is a `ConversionWarning`:

| Field       | Contents                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`      | A stable code. The prefix gives the type of loss. See below.                                                                                            |
| `message`   | A description for a person to read.                                                                                                                     |
| `element`   | The MusicXML element that the loss is about, without angle brackets. It is present if the loss is about one element.                                    |
| `attribute` | The attribute that the loss is about, with its `element`. It is present if the loss is about one attribute.                                             |
| `context`   | The location: `part` (the MusicXML part id), `measure` (the source measure number), and `line` (the source line). Each field is present if it is known. |

An empty `warnings` array shows that the conversion lost nothing, as far as
the converter can tell. A pipeline can test for this.

The prefix of `code` gives the type of loss:

- `unsupported:` shows a gap in this converter. A later release can close it.
  To test for it, use `isConverterGap(code)`.
- `unrepresentable:` shows a limit of MNX. No release closes it while the
  output format stays the same. To test for it, use `isFormatLimit(code)`.
- All other prefixes (`inconsistent:`, `missing:`, `unresolved:`, `unclosed:`,
  `redundant:`) show a problem in the source file. An upgrade does not change
  these warnings.

After an upgrade, convert again only the files that have converter gaps:

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
is the default. The command `ossia to-mnx song.mxl` does the same operation.
If the command cannot convert a file, it reports the reason. It then
continues with the other files.

- `--fail-on-loss` exits non-zero if a conversion loses notation.
- `--report <file>` writes the warnings from all files to `<file>` as JSON.
- `--validate` checks each output against the vendored MNX schema.
- `-h` and `-v` print the help and the version.

The exit code is the contract for a pipeline:

- `0`: all files converted. With `--fail-on-loss`, no file lost notation.
- `1`: a file did not convert, did not validate, or lost notation with
  `--fail-on-loss`.
- `2`: usage error.

---

## What converts

- Notes, rests, and chords, with pitches, note values, and augmentation dots.
- More than one voice in a measure.
- Clefs, including a clef change in the middle of a measure. Key signatures
  and time signatures.
- Staff line counts. A staff drawn on other than five lines becomes a staff
  config on the measure that changes it. MNX measures a staff position from
  the middle of the staff, and the middle moves with the count, therefore the
  converter reads every clef and every drawn height against the count in
  force.
- Part names, with the short name for the later systems.
- Measure numbers that are different from plain 1, 2, 3. A pickup measure
  keeps its number.
- Tuplets, including nested tuplets.
- Grace notes. The converter collects them into groups that use no measure
  time.
- Tremolos. A tremolo on one note becomes a mark that counts its beams. A
  tremolo across two notes becomes one item that holds the pair. A pair in a
  tuplet also converts.
- Dynamics, from pppppp to ffffff. The converter puts each mark at the cursor
  point under its staff. A sforzando and its related marks become accent
  dynamics with their combined glyphs. Words around a mark, such as the "più"
  of "più f", become a prefix or a suffix. The converter reports a mark that
  is not in the MNX vocabulary.
- Hairpins. The converter matches the two ends across measures. It writes one
  gradual dynamic that points at the measure where the hairpin stops.
- Tempo marks. A metronome mark becomes a tempo on the score. A `<sound>`
  tempo is playback and not a drawn mark, therefore the converter reports it
  and does not convert it. If a metronome mark beside it states the same
  value, the `<sound>` tempo is the echo of that mark and the converter stays
  silent. An `<offset>` moves a mark to the time that it belongs to.
- Rolled chords, and the bracket that shows that a chord sounds together. MNX
  states each one time beside the chord, across the notes.
- Octave shifts. The converter matches the two ends. Both formats keep the
  sounding pitch on the notes, therefore the converter transposes nothing.
- Articulations: staccato, tenuto, accent, staccatissimo, spiccato, stress,
  soft accent, and strong accent with its direction. Up-bow and down-bow.
  Breath marks with their glyphs. Fermatas with their shape and direction.
- Barlines, repeat signs, and first and second endings. MNX states an ending
  as the count of measures that it covers.
- Segno signs with their glyphs, Fine, and dal segno jumps. A jump becomes
  D.S. al Fine if a Fine is on the way back.
- Measure repeats. MNX marks the first measure of each repetition with the
  pattern length. The converter reports a sign with more than one slash.
- Multi-measure rests, with their start measure and their count.
- Accidentals. The output declares that accidental display is explicit. The
  converter marks each accidental that the source draws. Cautionary
  accidentals keep their parentheses or brackets.
- Lyrics, verse by verse. Each syllable keeps its place in its word.
- Stem directions.
- Multi-staff parts. A piano part stays one part. Each voice states its
  staff. A voice that reaches the other staff carries overrides on its
  events.
- Part groups. Brackets and braces become nested staff groups. The converter
  reports groups with edges that cross. The converter renames a part id that
  does not fit the MNX id pattern. It also renames an id shaped like one that
  the converter gives an event, note, measure, or layout. The new id is p1,
  p2, and so on, and the converter reports each rename.
- System breaks and page breaks. They become pages and systems in the score
  rendering.
- Transposing instruments. MusicXML writes the pitch the player reads; MNX
  writes the pitch the instrument sounds. The converter carries every pitch of
  a part with a `<transpose>` to what it sounds, states the key the music
  sounds in, and gives the part the interval back to the written pitch. MNX
  states one transposition for each part, therefore the converter reports a
  part whose staves disagree or which changes instrument partway.
- Instrument names from the part list. They become the sounds of the score,
  each with the MIDI pitch that plays it where the part list gives one. The
  rest of the synthesizer setup has no place in MNX, therefore the converter
  reports it. The converter renames an instrument id that does not fit the MNX
  id pattern, and reports each rename.
- Percussion. An unpitched note becomes a note struck on the part's kit. The
  kit states each instrument one time, with its name, the sound that plays it,
  and its place on the staff. Two notes strike the same instrument when they
  name the same instrument and sit at the same height. The converter reads the
  heights on such a staff as the treble clef gives them, which is how
  percussion is written and read. MNX states the C, F and G clefs only, so it
  writes a percussion clef as the treble clef with the SMuFL glyph MNX's clef
  carries for a drawn sign, drawn on the line the source states. It reports a
  TAB, jianpu or "none" clef and writes the staff without a clef. A rolled
  chord struck on a kit runs between the two components that the part's kit
  draws lowest and highest.
- Beams, including secondary beams, hooks, and beams over a grace group. The
  converter builds them as the MNX tree of beams over the measure.
- Grace notes. Consecutive grace notes become one group, with the slash where
  the source draws one. The converter states which side the group takes its
  time from. Where the source names two different sides in one run, the
  converter cuts the run between them, because MNX states one side for each
  group. It does not cut a run under a beam, because each group beams within
  itself; it reports the side instead. A grace note that names no side joins
  the group that is open. MNX states no amount of time taken, therefore the
  converter reports the amount.
- Ties and slurs, joined across barlines. The converter reports a tie or a
  slur with only one end.
- Exact timing. The converter reads durations as exact fractions of
  `<divisions>`, and it follows `<backup>` and `<forward>`. If a `<backup>`
  reaches before the measure start, the converter reports the disagreement and
  writes at the measure start whatever the source writes out there. A silent gap in a voice becomes a
  space. If a note states no note value, the converter calculates the value
  from the duration. A rest that fills its measure keeps
  no invented note value.

**Planned for v1:** free text directions. The pinned snapshot of the spec has
no place for them.

**Reported, never converted:** constructs that MNX cannot express, such as
pedal marks and ornaments. The converter always reports these as warnings.
It never drops them silently.

**Out of scope for v1:** chord symbols, which convert with an `unsupported:`
warning. A `score-timewise` document gets a clear error, and the converter
rejects it.

**Rejected, not half-converted:** a grace note that carries a tuplet ratio
with no bracket around it. MusicXML states a tuplet as a ratio on each note
and a bracket around the notes. The converter reads the ratio where the
bracket is missing, because the ratio states the length of the group. A grace
note takes none of the measure's time, therefore its ratio states no length,
and the converter rejects the file.

---

## Tested against real scores

The converter runs against each file below. There are four checks:

1. The file converts.
2. The output agrees with the vendored MNX schema.
3. The pitches agree with the source note for note, per measure and per
   voice.
4. Each measure has the length that the source states.

A file agrees with all four checks. If it does not, the converter refuses the
file and gives the reason. The counts are from September 2026, except the
String Quartets row, which is from July 2026. The Lieder corpus continues to
grow, and the weekly gate runs against its latest state.

| Corpus                                                                                                        | Files  | Convert      |
| ------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| [OpenScore Lieder](https://github.com/OpenScore/Lieder) (songs, MuseScore exports)                            | 1,462  | 1,462 (100%) |
| [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) (exported with MuseScore 3)          | 122    | 112 (92%)    |
| [Unofficial MusicXML Test Suite](https://github.com/cuthbertLab/musicxmlTestSuite) (feature files)            | 150    | 142 (95%)    |
| [MusicXML example set](https://www.musicxml.com/music-in-musicxml/example-set/) (Finale exports, some UTF-16) | 36     | 34 (94%)     |
| [PDMX](https://zenodo.org/records/15571083) random sample (MuseScore.com, all genres)                         | 20,000 | 19,982 (99%) |
| [music21 bundled corpus](https://github.com/cuthbertLab/music21) (hand-encoded, older tools, some UTF-16)     | 654    | 646 (99%)    |
| [CPDL](https://www.cpdl.org) random sample (choral, mostly Sibelius exports)                                  | 2,000  | 1,985 (99%)  |

The other files are refusals, and each refusal names its reason. Some files
hold notation that MNX cannot state: composite meters such as 3+2/8. Other
files disagree with themselves. Examples are a note whose written value and
measured length disagree in a way no note value can write, a chord whose
notes last different times, and a voice that holds both a rest filling its
measure and notes written after it.

Closed-score hymnals write two lines in one voice, laid over each other with
`<backup>`. MNX states each line as its own sequence of the measure, so the
converter splits them rather than refusing the file, and reports the split.
It does not guess which line is which: a note stays in the sequence its
voice last sounded in wherever that has room, and takes another only where
that one is still sounding.

The test suite converts 600 vendored Lieder songs on each run, together with
seven feature files from the Unofficial MusicXML Test Suite. Lieder is voice
and piano throughout, therefore it contains no bow mark, no unpitched note and
no transposing part. The seven files hold what the songs cannot. CI runs the
full Lieder corpus weekly and on demand.

---

## Safe on untrusted input

Most MusicXML files carry a DOCTYPE that points at an external DTD URL. The
XML layer never resolves external entities, and it never processes DTDs.
Therefore XXE attacks and entity-expansion ("billion laughs") attacks do not
apply.

---

## MNX spec pinning

MNX is a draft that changes. Each release pins one
[w3c/mnx](https://github.com/w3c/mnx) commit. The repository holds the schema
at `schema/mnx-schema.json`. [`schema/PROVENANCE.md`](schema/PROVENANCE.md)
records its source commit and its checksum. The test suite validates each
conversion against the schema.

The package exports the whole MNX output vocabulary as types, so anything in
an `MNXDocument` can be named. Those types state the pinned schema. Moving the
pin can therefore change them, and a release that moves it says so.

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

For the structure of the converter and the reasons for it, see
[docs/architecture.md](docs/architecture.md). For the working conventions,
see [AGENTS.md](AGENTS.md).

---

## License

MIT
