# mnxml

Convert [MusicXML](https://www.w3.org/2021/06/musicxml40/) to
[MNX](https://w3c-cg.github.io/mnx/docs/), the W3C Music Notation Community
Group's JSON successor format.

> **Early development.** The public API below works, but only a small slice of
> MusicXML converts so far — see [What converts today](#what-converts-today).
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

// Anything MusicXML expressed that MNX can't — or that this converter doesn't
// handle yet — is reported, never dropped silently.
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

Single-voice measures: notes and rests with their note values and augmentation
dots, pitches, clefs (including a second `<attributes>` block mid-measure),
key and time signatures, part names, and measure numbering that differs from
plain 1, 2, 3, so a pickup measure keeps its number.

Planned for v1: chords, multiple voices, multi-staff parts, ties, slurs, beams
including secondary breaks and hooks, tuplets, grace notes, lyrics, dynamics,
hairpins, tempo, articulations, repeat barlines and endings, and octave
shifts.

Constructs that MNX cannot express at all, such as pedal marks and percent
repeats, will always surface as warnings rather than silent loss. Out of scope
for v1: percussion, chord symbols, transposing-instrument handling, and
`score-timewise` documents, which are rejected with a clear error.

**One known gap worth stating plainly:** note values are read from `<type>`,
and `<duration>`/`<divisions>` are not yet read at all. A file whose
`<duration>` disagrees with its `<type>` therefore converts by the `<type>`,
and that disagreement is not currently reported. Cross-checking the two
arrives with the timing core. A `<note>` with no `<type>` is rejected rather
than guessed at.

---

## Design principles

**Never lose notation silently.** Every construct that doesn't survive
conversion emits a `ConversionWarning` with a stable code and measure context,
so a pipeline can gate on "zero losses" and know it means something.

**Strict about broken input.** Malformed structure throws with a document path
and source line rather than being guessed at. Every heuristic that does exist
is documented and announces itself through a warning when it fires.

**Exact timing.** Durations are exact rationals, never floats — tuplets produce
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
