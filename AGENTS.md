# musicxml-to-mnx

> Converts MusicXML to MNX, the W3C JSON music notation format. MusicXML in, MNX out.

## What this is

A general-purpose library that reads MusicXML and writes MNX, aimed at real repertoire rather than a subset of it.

First consumer is a batch pipeline over the CC0 [OpenScore Lieder corpus](https://github.com/OpenScore/Lieder), but nothing in the design is corpus-specific.

## Workflow

- **Every conversion output in tests must validate against the vendored MNX schema.** It is the conformance oracle: it is the only thing that checks the output is legal MNX rather than merely the shape we expected. A test that asserts on output shape without schema-validating it is only half a test. Tests convert through `convertValid` and `writeValid` in `tests/support/convert.ts`, which check every output; ESLint rejects a direct call to the converter or the writer except where the test expects it to throw.
- **When a corpus check fails, find out whether the code or the check is wrong before changing either.** Every real defect so far was found by running against real music, and more than once the failing check was the thing at fault, not the converter: a measure with five quarters in a 3/4 bar (the source, not us), lyrics compared in document order when voices interleave through the cursor. The move is to reproduce the disagreement in isolation and understand it, not to relax the assertion until it passes or regenerate the baseline until it is quiet. A check weakened to make a mystery go away is worse than no check. Once understood, either fix the converter or make the check compare the right thing (per voice, per verse, against the source's own measure length), and keep it strict.
- **Never drop notation silently.** Anything MusicXML expresses that MNX cannot, or that this converter doesn't handle yet, emits a `ConversionWarning` with a stable code and measure context. Silent loss is a bug by definition: a pipeline must be able to tell a lossless conversion from a lossy one.
- **Use simple, standard music-notation language in comments, commit messages, docs, and names.** Say what MusicXML and MNX say: measure, note, rest, chord, voice, staff, beam, tuplet, slur, tie, clef, key signature, time signature, divisions. Don't invent project-private synonyms, and don't reach for fancier words when the standard one exists.

## Architecture

Two stages through an internal, MNX-shaped model. MusicXML knowledge stops at the reader; MNX types start at the writer.

```
MusicXML → xml/ (strict parse) → read/ → model/ (internal IR) → write/ → { mnx, warnings }
```

- `xml/`: a thin layer over `@rgrove/parse-xml`: parse, map character offsets to line numbers, typed tree accessors that throw `MusicXMLError` with position context.
- `read/`: the hard part. Divisions arithmetic as exact fractions, `<backup>`/`<forward>` cursor handling, voice bucketing, staff assignment, spanner resolution by `number` attribute.
- `model/`: the internal score IR. **Internal, never exported.** It follows MNX's structure. It keeps MusicXML encoding out of the writer and MNX types out of the reader. It is not a notation framework; keep it conversion-scoped.
- `write/`: walks the model and emits MNX. Thin by design.

Stage boundaries are enforced by dependency-cruiser rules in `.dependency-cruiser.js` (`pnpm deps:check`). A crossing is an architecture change: amend `docs/architecture.md` first.

## Key decisions

- **Language**: TypeScript. Isomorphic core (browser + Node); a Node-only CLI is a separate `bin` build.
- **XML parser**: `@rgrove/parse-xml`, which has zero dependencies, is actively maintained, and is safe by construction against XXE and entity-expansion attacks. This matters: MusicXML files carry a DOCTYPE pointing at an external DTD URL, so a parser that resolved external entities would be a live SSRF vector on untrusted input.
- **Timing**: exact rational arithmetic (`src/fraction.ts`), never floats. Tuplets produce durations like 1/3 of a beat; float drift would make measure-fill checks flaky.
- **Errors vs warnings**: structurally broken input throws `MusicXMLError` (with document path and source line); valid-but-unconvertible input produces a warning. Never guess silently.
- **Package manager**: pnpm (committed lockfile).
- **Supply chain**: exact-pinned deps, dependency install scripts blocked, 24h new-release cooldown, all configured in `pnpm-workspace.yaml`. CI actions pinned to commit SHAs.
- **Linting**: ESLint (flat config) + typescript-eslint, non-type-checked. Prettier owns formatting. dependency-cruiser owns the import graph.

## MNX output

The authoritative wire format is the vendored schema at `schema/mnx-schema.json`, pinned to a specific w3c/mnx commit (see `schema/PROVENANCE.md`). `src/types/mnx.ts` is hand-written to match it. MNX has no stable 1.0, so when the pin moves, that is a deliberate release: re-pin, regenerate goldens, rerun the corpus gate.

## Reference

- MNX spec: https://w3c-cg.github.io/mnx/docs/
- MNX schema: https://github.com/w3c/mnx/blob/main/docs/mnx-schema.json
- MusicXML spec: https://www.w3.org/2021/06/musicxml40/
- Architecture and design rationale: `docs/architecture.md`
