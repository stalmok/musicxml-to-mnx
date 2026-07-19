# mnxml

> Converts MusicXML to MNX, the W3C JSON music notation format. MusicXML in, MNX out.

## Workflow

- **Verify your work before every commit, always.** Beyond the checks below, confirm the change actually does what it's meant to: run it, exercise the behavior, read the output. If you cannot verify it, stop and ask before committing. Never commit unverified work.
- **Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test:coverage` before every commit**, and all must pass. A pre-commit hook (`.githooks/pre-commit`) enforces these; enable it once per clone with `pnpm hooks:install`.
- **Keep test coverage ≥ 95%.** Thresholds are set in `vite.config.ts`. Cover new behavior with real tests; don't pad coverage with tests that assert nothing.
- **Run `pnpm audit` after installing or updating any package**, and resolve findings before committing.
- **Every conversion output in tests must validate against the vendored MNX schema.** It is the conformance oracle: it is the only thing that checks the output is legal MNX rather than merely the shape we expected. A test that asserts on output shape without schema-validating it is only half a test.
- **Never drop notation silently.** Anything MusicXML expresses that MNX cannot, or that this converter doesn't handle yet, emits a `ConversionWarning` with a stable code and measure context. Silent loss is a bug by definition: a pipeline must be able to tell a lossless conversion from a lossy one.
- **Use simple, standard music-notation language in comments, commit messages, docs, and names.** Say what MusicXML and MNX say: measure, note, rest, chord, voice, staff, beam, tuplet, slur, tie, clef, key signature, time signature, divisions. Don't invent project-private synonyms, and don't reach for fancier words when the standard one exists.
- **Review each milestone with a fresh-context review before moving on.** Run a code review over that milestone's diff and act on the findings. Don't batch several milestones into one review.
- **Keep source and tests milestone-agnostic.** No milestone numbers (C1, C4, …) in code, comments, tests, or fixture names, because they read as noise to anyone in the code later. Describe the behavior or the deferred capability generically ("beams are not converted yet", not "lands in C4"). Roadmap and milestone framing belongs in local working notes, never in the repo.

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
