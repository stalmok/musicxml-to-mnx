# mnxml

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the W3C Music Notation Community
Group's JSON successor format.

> **Early development.** The public API below works, but only a small slice of
> MusicXML converts so far. See [What converts today](#what-converts-today).
> MNX itself has no stable 1.0, so output is pinned to a dated spec snapshot.

---

## Install

```bash
npm install mnxml   # or: pnpm add mnxml
```

Runs in Node and the browser. One runtime dependency
([`@rgrove/parse-xml`](https://github.com/rgrove/parse-xml)).

---

## Use

```ts
import { convertMusicXML } from 'mnxml'

const { mnx, warnings } = convertMusicXML(musicXmlSource)

console.log(JSON.stringify(mnx, null, 2))

// Anything MusicXML expressed that MNX cannot carry, or that this
// converter does not handle yet, is reported rather than dropped silently.
for (const w of warnings) {
  console.warn(`${w.code}: ${w.message}`, w.context)
}
```

Structurally broken input throws a `MusicXMLError` carrying the document path
and the source line:

```ts
import { MusicXMLError } from 'mnxml'

try {
  convertMusicXML(source)
} catch (e) {
  if (e instanceof MusicXMLError) {
    console.error(e.message, e.path, e.line)
  }
}
```

---

## What converts today

Notes and rests with their note values and augmentation dots, pitches, chords,
several voices in a measure, clefs (including a second `<attributes>` block
mid-measure), key and time signatures, part names, and measure numbering that
differs from plain 1, 2, 3, so a pickup measure keeps its number.

Tuplets, including nested ones, and grace notes, which are gathered into
groups and keep out of the measure's time.

Beams, including secondary beams and hooks. MusicXML puts them on the notes,
one marking per beam level; MNX states them over the measure as a tree, and
that is what gets built.

Ties and slurs, joined up across barlines. MusicXML marks both ends and leaves
the connection implied; MNX states it once, on the end where it begins, as a
reference to the end where it finishes. Anything with only one of its two ends
is reported rather than guessed at, because real scores contain those.

Timing is followed properly: durations are read in `<divisions>` as exact
fractions, `<backup>` and `<forward>` move the cursor, a note value is
recovered from its duration where none is written, and time a voice passes
over in silence is stated as a space. A rest filling its measure becomes what
MNX states it as, rather than being given an invented note value.

Planned for v1: multi-staff parts, lyrics, dynamics, hairpins, tempo,
articulations, repeat barlines and endings, and octave shifts.

Constructs that MNX cannot express at all, such as pedal marks and percent
repeats, will always surface as warnings rather than silent loss. Out of scope
for v1: percussion, chord symbols, transposing-instrument handling, and
`score-timewise` documents, which are rejected with a clear error.

**What is rejected rather than half-converted:** a tremolo written across two
notes, whose written values overfill the measure exactly as a tuplet's do, and
a tuplet whose extent the source does not bracket. MusicXML states a tuplet twice, as a ratio on every
note and as a bracket around them, and without the bracket there is nothing to
say where one tuplet ends and the next begins. Guessing would invent a
grouping the source never wrote.

---

## Design principles

**Never lose notation silently.** Every construct that doesn't survive
conversion emits a `ConversionWarning` with a stable code and measure context,
so a pipeline can gate on "zero losses" and know it means something.

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
```

See [docs/architecture.md](docs/architecture.md) for how the converter is put
together and why, and `CLAUDE.md` for the working conventions.

---

## License

MIT
