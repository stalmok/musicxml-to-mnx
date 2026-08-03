# ossia

> Converts MusicXML to MNX, the W3C JSON music notation format. MusicXML in, MNX out.

## Workflow

- **Verify your work before every commit, always.** Beyond the checks below, confirm the change actually does what it's meant to: run it, exercise the behavior, read the output. If you cannot verify it, stop and ask before committing. Never commit unverified work.
- **Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test:precommit` before every commit**, and all must pass. A pre-commit hook (`.githooks/pre-commit`) enforces these; enable it once per clone with `pnpm hooks:install`. `test:precommit` runs the whole suite except the 200-song vendored corpus (which takes minutes) and still holds the coverage thresholds. The full corpus runs in CI on every push and pull request; run it locally with `pnpm test:coverage` (everything) or `pnpm test:corpus` (just the vendored corpus) before anything that touches the reader, writer, or model.
- **Keep test coverage ≥ 98%.** Thresholds are set in `vite.config.ts`. Cover new behavior with real tests; don't pad coverage with tests that assert nothing.
- **Run `pnpm audit` after installing or updating any package**, and resolve findings before committing.
- **Every conversion output in tests must validate against the vendored MNX schema.** It is the conformance oracle: it is the only thing that checks the output is legal MNX rather than merely the shape we expected. A test that asserts on output shape without schema-validating it is only half a test.
- **When a corpus check fails, find out whether the code or the check is wrong before changing either.** Every real defect so far was found by running against real music, and more than once the failing check was the thing at fault, not the converter: a measure with five quarters in a 3/4 bar (the source, not us), lyrics compared in document order when voices interleave through the cursor. The move is to reproduce the disagreement in isolation and understand it, not to relax the assertion until it passes or regenerate the baseline until it is quiet. A check weakened to make a mystery go away is worse than no check. Once understood, either fix the converter or make the check compare the right thing (per voice, per verse, against the source's own measure length), and keep it strict.
- **Check whether MusicXML allows several of it before reaching for `child()`.** `child(element, X)` takes the first, which has been wrong four times now: `<attributes>` (a clef change mid-measure), `<notations>` (a tie in one block, a tuplet marker in another), `<key>`/`<time>` (one per staff), and nearly `<clef>`. In the vendored corpus alone, `<beam>` repeats 1352 times inside one `<note>`, `<lyric>` 45 times, and `<tie>` 12 times. Reach for `children()` unless the format says there can be only one, and say in a comment which it is.
- **Never drop notation silently.** Anything MusicXML expresses that MNX cannot, or that this converter doesn't handle yet, emits a `ConversionWarning` with a stable code and measure context. Silent loss is a bug by definition: a pipeline must be able to tell a lossless conversion from a lossy one.
- **Use simple, standard music-notation language in comments, commit messages, docs, and names.** Say what MusicXML and MNX say: measure, note, rest, chord, voice, staff, beam, tuplet, slur, tie, clef, key signature, time signature, divisions. Don't invent project-private synonyms, and don't reach for fancier words when the standard one exists.
- **Review each milestone with a fresh-context review before moving on.** Run a code review over that milestone's diff and act on the findings. Don't batch several milestones into one review.
- **Keep source and tests milestone-agnostic.** No milestone numbers (C1, C4, …) in code, comments, tests, or fixture names, because they read as noise to anyone in the code later. Describe the behavior or the deferred capability generically ("beams are not converted yet", not "lands in C4"). Roadmap and milestone framing belongs in the GitHub issue tracker, never in the repo.
- **Track bugs, gaps, and deferred work as GitHub issues.** The `stalmok/ossia` issue tracker is the live record of what is known-broken, unhandled, or deliberately deferred, labelled by tier: `silent-loss` (drops notation with no warning, a bug by the rule above), `notation-gap` (a feature with an MNX home, not built yet), `blocked-upstream` (real loss with no home in the current schema pin), `by-design` (a deliberate whole-file refusal), and `latent` (a possible defect not yet seen in the corpus). Open an issue when you find a new bug or gap; close it referencing the commit when you fix one. `plan.md` is a frozen local working log from earlier milestones (gitignored, not maintained): read it for historical context if useful, but do not update it and do not treat it as the current state of the work.

## What this is

A general-purpose library that reads MusicXML and writes MNX, aimed at real repertoire rather than a subset of it.

First consumer is a batch pipeline over the CC0 [OpenScore Lieder corpus](https://github.com/OpenScore/Lieder), but nothing in the design is corpus-specific.

## Architecture

Two stages through a neutral intermediate model. MusicXML knowledge stops at the reader; MNX knowledge starts at the writer.

```
MusicXML → xml/ (strict parse) → read/ → model/ (neutral IR) → write/ → { mnx, warnings }
```

- `xml/`: a thin layer over `@rgrove/parse-xml`: parse, map character offsets to line numbers, typed tree accessors that throw `MusicXMLError` with position context.
- `read/`: the hard part. Divisions arithmetic as exact fractions, `<backup>`/`<forward>` cursor handling, voice bucketing, staff assignment, spanner resolution by `number` attribute.
- `model/`: the neutral score IR. **Internal, never exported.** It exists to decouple the two stages, not to be a notation framework; keep it conversion-scoped.
- `write/`: walks the model and emits MNX. Thin by design.

Stage boundaries are enforced by `no-restricted-imports` rules in `eslint.config.js`. A crossing is an architecture change: amend `docs/architecture.md` first.

## Key decisions

- **Language**: TypeScript. Isomorphic core (browser + Node); a Node-only CLI is a separate export path.
- **XML parser**: `@rgrove/parse-xml`, which has zero dependencies, is actively maintained, and is safe by construction against XXE and entity-expansion attacks. This matters: MusicXML files carry a DOCTYPE pointing at an external DTD URL, so a parser that resolved external entities would be a live SSRF vector on untrusted input.
- **Timing**: exact rational arithmetic (`src/fraction.ts`), never floats. Tuplets produce durations like 1/3 of a beat; float drift would make measure-fill checks flaky.
- **Errors vs warnings**: structurally broken input throws `MusicXMLError` (with document path and source line); valid-but-unconvertible input produces a warning. Never guess silently.
- **Package manager**: pnpm (committed lockfile).
- **Supply chain**: exact-pinned deps, dependency install scripts blocked, 24h new-release cooldown, all configured in `pnpm-workspace.yaml`. CI actions pinned to commit SHAs.
- **Linting**: ESLint (flat config) + typescript-eslint, non-type-checked. Prettier owns formatting.

## MNX output

The authoritative wire format is the vendored schema at `schema/mnx-schema.json`, pinned to a specific w3c/mnx commit (see `schema/PROVENANCE.md`). `src/types/mnx.ts` is hand-written to match it. MNX has no stable 1.0, so when the pin moves, that is a deliberate release: re-pin, regenerate goldens, rerun the corpus gate.

## Reference

- MNX spec: https://w3c-cg.github.io/mnx/docs/
- MNX schema: https://github.com/w3c/mnx/blob/main/docs/mnx-schema.json
- MusicXML spec: https://www.w3.org/2021/06/musicxml40/
- Architecture and design rationale: `docs/architecture.md`
