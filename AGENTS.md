# musicxml-to-mnx

> Converts MusicXML to MNX, the W3C JSON music notation format. MusicXML in, MNX out.

## What this is

A general-purpose library that reads MusicXML and writes MNX.

The main test corpus is the CC0 [OpenScore Lieder corpus](https://github.com/OpenScore/Lieder). Do not add behavior specific to one corpus.

## Checks

The [Development](README.md#development) section lists the setup. Run these before every commit. All must pass:

```bash
pnpm typecheck
pnpm lint
pnpm deps:check
pnpm format:check
pnpm test:precommit
```

The pre-commit hook runs the same checks. Enable it once per clone with `pnpm hooks:install`. `test:precommit` runs the whole suite without the vendored corpus and the performance tests, and holds the coverage thresholds. Run `pnpm test:perf` before you commit a change to the reader, the model or the writer.

There are two corpus runs:

- **Vendored corpus**: 600 Lieder songs committed in `tests/corpus/`. Run `pnpm test:corpus` before you commit a change to the reader, the model or the writer. CI runs it on pushes to main and on pull requests that change the converter, the schema, the checks, the songs or the dependencies.
- **Full Lieder corpus**: not in the repository. The weekly `corpus.yml` workflow clones it. To run it locally, clone the corpus and run `MUSICXML_TO_MNX_CORPUS=<clone>/scores pnpm corpus-gate`.

## Workflow

- **Every conversion output in tests must validate against the vendored MNX schema.** Tests convert through `convertValid` and `writeValid` in `tests/support/convert.ts`, which check every output. ESLint rejects a direct call to the converter or the writer, except where the test expects it to throw.
- **When a corpus check fails, find out whether the code or the check is wrong before you change either.** Sometimes the check is at fault. Examples: a measure with five quarters in a 3/4 bar (a defect in the source file), and lyrics compared in document order when voices interleave through the cursor. Reproduce the disagreement in isolation and understand it. Do not relax the assertion or regenerate the baseline until the failure stops. Then either fix the converter, or make the check compare the right thing (per voice, per verse, against the source's own measure length). Keep the check strict.
- **Never drop notation silently.** Anything MusicXML expresses that MNX cannot, or that this converter does not handle yet, emits a `ConversionWarning` with a stable code and measure context.
- **Use simple, standard music-notation language in comments, commit messages, docs, and names.** Use the terms MusicXML and MNX use: measure, note, rest, chord, voice, staff, beam, tuplet, slur, tie, clef, key signature, time signature, divisions. Do not invent project-specific synonyms.
- **Keep test coverage at 98% or more.** `vite.config.ts` sets the thresholds. Cover new behavior with real tests. Do not add tests that assert nothing to raise coverage.
- **Run mutation tests over new code.** `pnpm test:mutation` runs Stryker over all shipped source. To run it over only your files, use `npx stryker run --mutate 'src/read/a.ts,src/read/b.ts'` (one comma-separated list). Kill each surviving mutant with a test, or record it as equivalent, with the reason.
- **Run `pnpm audit` after you install or update a package.** Resolve its findings before you commit.

## Conventions

- **Check whether MusicXML allows more than one of an element before you use `child()`.** `child(element, X)` returns the first match only. Elements that can repeat include `<attributes>` (a clef change mid-measure), `<notations>` (a tie in one block, a tuplet in another), `<key>` and `<time>` (one per staff), and `<beam>`, `<lyric>` and `<tie>` inside one `<note>`. Use `children()` unless the format allows only one. Say which it is in a comment.
- **Prefer the compiler to a test, and a test to a comment.** If a fact is duplicated inside the repository, make the types carry it. A reader set that restates a model union is `['A', ...] as const satisfies readonly Step[]`, not `ReadonlySet<string>` with a cast. A table keyed by a union is `Record<Union, T>`, not an array of pairs with a runtime check. Before you add `/* v8 ignore */` to an "impossible" branch, try to make the types exclude it. Where the compiler cannot reach, write a test. Make each test entry state the fact it depends on.
- **A fact stated twice needs a check that compares the two copies.** `tests/schema-conformance.test.ts` holds three copies of schema facts to `schema/mnx-schema.json`: the types in `src/types/mnx.ts`, the registry of unrepresentable notation in `src/read/unrepresentable.ts`, and the id pattern in `src/ids.ts`. It also compares the model's enums in `src/model/score.ts` with the types. Add new copies to that test. Do not start a copy that nothing checks.
- **Write import rules in `.dependency-cruiser.js`, not in comments.** It is the only place the stage boundaries are written down. It also rejects cycles, files that no entry point reaches, Node core modules in the isomorphic `src`, devDependencies in shipped code, and test code in shipped code. Test a new rule against a planted violation before you trust a clean run.

## Architecture

Two stages through an internal, MNX-shaped model. MusicXML knowledge stops at the reader. MNX types start at the writer.

```
MusicXML → xml/ (strict parse) → read/ → model/ (internal IR) → write/ → { mnx, warnings }
```

- `xml/`: a thin layer over `@rgrove/parse-xml`. It parses, maps character offsets to line numbers, and gives typed tree accessors that throw `MusicXMLError` with position context.
- `read/`: most of the logic. Divisions arithmetic as exact fractions, `<backup>`/`<forward>` cursor handling, voice bucketing, staff assignment, spanner resolution by `number` attribute.
- `model/`: the internal score IR. **Internal, never exported.** It follows MNX's structure. It keeps MusicXML encoding out of the writer and MNX types out of the reader. It is not a notation framework. Keep it conversion-scoped.
- `write/`: walks the model and emits MNX. Thin by design.

Dependency-cruiser rules in `.dependency-cruiser.js` enforce the stage boundaries (`pnpm deps:check`). A crossing is an architecture change. Amend `docs/architecture.md` first.

## Key decisions

- **Language**: TypeScript. Isomorphic core (browser and Node). A Node-only CLI is a separate `bin` build.
- **XML parser**: `@rgrove/parse-xml`. It has zero dependencies and is safe by construction against XXE and entity-expansion attacks. MusicXML files carry a DOCTYPE that points at an external DTD URL. A parser that resolves external entities would be an SSRF vector on untrusted input.
- **Timing**: exact rational arithmetic (`src/fraction.ts`), never floats. Tuplets produce durations like 1/3 of a beat.
- **Errors vs warnings**: structurally broken input throws `MusicXMLError` (with document path and source line). Valid input that cannot be converted produces a warning. Never guess silently.
- **Package manager**: pnpm (committed lockfile).
- **Supply chain**: exact-pinned deps, dependency install scripts blocked, 24h new-release cooldown, all configured in `pnpm-workspace.yaml`. CI actions pinned to commit SHAs.
- **Linting**: ESLint (flat config) and typescript-eslint, non-type-checked. Prettier owns formatting. Dependency-cruiser owns the import graph.

## MNX output

The authoritative wire format is the vendored schema at `schema/mnx-schema.json`. It is pinned to a specific w3c-cg/mnx commit (see `schema/PROVENANCE.md`). `src/types/mnx.ts` is hand-written to match it. MNX has no stable 1.0, so a move of the pin is a deliberate release: re-pin, regenerate goldens, rerun the corpus gate.

## Reference

- MNX spec: https://mnx.formats.music/docs/
- MNX schema: https://github.com/w3c-cg/mnx/blob/main/docs/mnx-schema.json
- MusicXML spec: https://www.w3.org/2021/06/musicxml40/
- Architecture and design rationale: `docs/architecture.md`
