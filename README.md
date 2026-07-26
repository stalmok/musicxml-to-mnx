# ossia

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the W3C Music Notation Community
Group's JSON successor format.

> **Pre-1.0.** MNX has no stable 1.0, so output is pinned to a dated spec
> snapshot and the API may still change. Most of what real song repertoire uses
> converts today — see [What converts today](#what-converts-today) — and
> anything that does not is reported.

---

## Install

```bash
npm install ossia   # or: pnpm add ossia
```

---

## Use

```ts
import { convertMusicXML } from 'ossia'

const { mnx, warnings } = convertMusicXML(musicXmlSource)

console.log(JSON.stringify(mnx, null, 2))

// Anything MusicXML expressed that MNX cannot carry, or that this
// converter does not handle yet, is reported in warnings.
for (const w of warnings) {
  console.warn(`${w.code}: ${w.message}`, w.context)
}
```

The source is either the XML as a string, or the bytes of a document or a
compressed `.mxl` package:

```ts
import { readFileSync } from 'node:fs'

const { mnx } = convertMusicXML(readFileSync('song.mxl'))
```

Structurally broken input throws a `MusicXMLError` carrying the document path
and the source line:

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

## Command line

The package installs a `ossia` command:

```bash
ossia to-mnx song.mxl                    # writes song.mnx beside it
ossia to-mnx scores/*.musicxml -o out/   # into a directory
ossia to-mnx *.mxl --fail-on-loss        # exit non-zero if anything is lost
ossia to-mnx song.mxl --validate --report losses.json
```

It accepts `.musicxml`, `.xml` and `.mxl`. A file it refuses is reported and
the rest go on. `--fail-on-loss` is the gate a lossless pipeline runs on;
`--report` writes every file's warnings as JSON; `--validate` checks each
output against the vendored MNX schema.

---

## What converts today

Notes and rests with their note values and augmentation dots, pitches, chords,
several voices in a measure, clefs (including a second `<attributes>` block
mid-measure), key and time signatures, part names, and measure numbering that
differs from plain 1, 2, 3, so a pickup measure keeps its number.

Tuplets, including nested ones, and grace notes, which are gathered into
groups and keep out of the measure's time.

Tremolos: on a single note as a mark on the event, counting its beams, and
written across two notes as one item holding the pair, including a pair
inside a tuplet.

Dynamics, hairpins and tempo marks: a dynamic sits on its measure at the point
the cursor has reached, under the staff it belongs to; a metronome mark becomes
a tempo on the score, as does the tempo a `<sound>` states where no metronome
beside it already says the same thing. An `<offset>` moves a mark from where it
is written to where it belongs, which is usually backwards. Marks outside MNX's
vocabulary, like a sforzando, are reported.

A hairpin is matched to its other end across the measures between, and stated
once as a gradual dynamic pointing at the measure where it stops.

Rolled chords, and the bracket that says a chord is struck together instead.
MusicXML marks every note; MNX states it once beside the chord, spanning the
notes it runs between.

Octave shifts, matched to their other end across the measures between. Both
formats put the sounding pitch on the notes and use the shift only to say how
the passage is drawn, so nothing is transposed.

Articulations and fermatas: staccatos, tenutos, accents, staccatissimos,
spiccatos, stresses, soft accents, and strong accents with the way they point;
breath marks with the glyph they are drawn with; and a fermata with its shape
and which way it faces.

Barlines, repeat signs, and first and second time endings. MusicXML hangs these
off one element at the edge of a measure and marks an ending's two ends several
measures apart; MNX states them on the score's measure, an ending as the number
of measures it covers.

Accidentals: the note whose accidental the source draws is marked, and the
document declares once that it states accidental display, so a reader takes
the marked notes as the whole of it. Cautionary accidentals keep their
parentheses or brackets.

Lyrics, verse by verse, keyed to each note with the syllable's place in its
word, and stem directions.

Multi-staff parts: a piano part stays one part, with the staff stated on each
voice and an override on the events of a voice that reaches across to the
other hand.

Beams, including secondary beams, hooks, and beams over a grace group.
MusicXML puts them on the notes, one marking per beam level; MNX states them
over the measure as a tree, and that is what gets built.

Ties and slurs, joined up across barlines. MusicXML marks both ends and leaves
the connection implied; MNX states it once, on the end where it begins, as a
reference to the end where it finishes. Anything with only one of its two ends
is reported rather than guessed at, because real scores contain those.

Timing is followed properly: durations are read in `<divisions>` as exact
fractions, `<backup>` and `<forward>` move the cursor, a note value is
recovered from its duration where none is written, and time a voice passes
over in silence is stated as a space. A rest filling its measure becomes what
MNX states it as, rather than being given an invented note value.

Planned for v1: free text directions, which wait on the spec pin moving,
since this snapshot has nowhere to put them.

Constructs that MNX cannot express at all, such as pedal marks and percent
repeats, will always surface as warnings rather than silent loss. Out of scope
for v1: percussion, chord symbols, transposing-instrument handling, and
`score-timewise` documents, which are rejected with a clear error.

**What is rejected rather than half-converted:** a tuplet whose extent the
source does not bracket. MusicXML states a tuplet twice, as a ratio on every
note and as a bracket around them, and without the bracket there is nothing to
say where one tuplet ends and the next begins. Guessing would invent a
grouping the source never wrote.

---

## Tested against real scores

Every file below is run through the converter and held to three checks: the
output validates against the vendored MNX schema, its pitches match the
source note for note, per measure and voice, and each measure sounds as long
as the source says. A file either passes all three or is refused with a
stated reason; none converts to wrong output. Counts are from the corpora as
of July 2026; the Lieder corpus keeps growing, and the gate meets it at its
tip.

| Corpus                                                                                                        | Files  | Convert      |
| ------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| [OpenScore Lieder](https://github.com/OpenScore/Lieder) (songs, MuseScore exports)                            | 1,462  | 1,431 (98%)  |
| [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) (exported with MuseScore 3)          | 122    | 112 (92%)    |
| [Unofficial MusicXML Test Suite](https://github.com/cuthbertLab/musicxmlTestSuite) (feature files)            | 150    | 136 (91%)    |
| [MusicXML example set](https://www.musicxml.com/music-in-musicxml/example-set/) (Finale exports, some UTF-16) | 36     | 32 (89%)     |
| [PDMX](https://zenodo.org/records/15571083) random sample (MuseScore.com, all genres)                         | 24,000 | 23,065 (96%) |
| [music21 bundled corpus](https://github.com/cuthbertLab/music21) (hand-encoded, older tools, some UTF-16)     | 654    | 614 (94%)    |
| [CPDL](https://www.cpdl.org) random sample (choral, mostly Sibelius exports)                                  | 2,000  | 1,834 (92%)  |

The remainder are refusals, each naming its reason: notation MNX cannot
state (percussion and TAB clefs, microtone alterations, composite meters
such as 3+2/8), or sources that disagree with themselves (a tuplet opened
and never closed, a backup reaching before the measure start, a metronome
stating no beats per minute, a voice resting through the same measure
twice). In the PDMX sample the two clef limits account for 692 of the 935
refusals: MuseScore.com carries a lot of drum and guitar music. In the
CPDL sample the largest group is hymnals writing two lines over each
other in a single voice, which the converter refuses rather than guesses
apart.

Two hundred of the Lieder songs are vendored into the repository and convert
on every test run; the full Lieder corpus gate runs weekly in CI and before
every release.

---

## Design principles

**Never lose notation silently.** Every construct that doesn't survive
conversion emits a `ConversionWarning` with a stable code and measure context,
so a pipeline can gate on "zero losses" and know it means something.

The code says which of three kinds it is. `unsupported:` is a gap in this
converter that a later release may close; `unrepresentable:` is a limit of MNX
that no release will close, and `isFormatLimit(code)` tests for it; anything
else is the source disagreeing with itself. Reconverting a file after an
upgrade is worth it for the first and never for the second.

```ts
import { isFormatLimit } from 'ossia'

const worthRetrying = warnings.some((w) => !isFormatLimit(w.code))
```

**Strict about broken input.** Malformed structure throws with a document path
and source line rather than being guessed at. Every heuristic that does exist
is documented and announces itself through a warning when it fires.

**Exact timing.** Durations are exact rationals, never floats, because tuplets produce
values like 1/3 of a beat, and float drift makes measure-fill checks unreliable.

**Safe on untrusted input.** MusicXML files carry a DOCTYPE referencing an
external DTD over HTTP. The XML layer never resolves external entities or
processes DTDs, so neither XXE nor entity-expansion ("billion laughs") attacks
apply.

---

## MNX spec pinning

MNX is a moving draft. Each release pins a specific
[w3c/mnx](https://github.com/w3c/mnx) commit; the schema is vendored at
`schema/mnx-schema.json` with its source commit and checksum recorded in
`schema/PROVENANCE.md`, and CI verifies those bytes. Every conversion the test
suite produces is validated against it.

---

## Development

```bash
pnpm install
pnpm hooks:install   # once per clone: enables the pre-commit gate

pnpm test            # pnpm test:coverage enforces the ≥95% thresholds
pnpm typecheck
pnpm lint
pnpm build

pnpm bench           # times each pipeline stage and whole conversions
```

Conversion time is guarded by tests: `tests/performance.test.ts` converts
generated scores at two sizes along each axis (measures, parts, notes per
measure) and fails if the time ratio approaches quadratic. The generator
behind those scores is itself tested for lossless, schema-valid output.

See [docs/architecture.md](docs/architecture.md) for how the converter is put
together and why, and `CLAUDE.md` for the working conventions.

---

## License

MIT
