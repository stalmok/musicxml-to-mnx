# Architecture

How the converter is put together. Usage and current capability are in the
README.

## Shape

Two stages with a shared model between them. MusicXML knowledge stops at the
reader and MNX knowledge starts at the writer. That is an import boundary,
not a knowledge one: the reader never sees the MNX types and the writer never
sees the XML layer, but the model leans toward MNX on purpose. Its enums are
spelled the way MNX spells them so the writer needs no second table, and the
reader owns the registry of what MNX has nowhere to put
(`read/unrepresentable.ts`), because a loss report needs the source line and
measure context that only the reader has in hand.

```
MusicXML string or bytes
  -> xml/    parse into a light element tree carrying line numbers
  -> read/   MusicXML semantics into the score model
  -> write/  score model into MNX JSON
  -> { mnx, warnings }
```

Nearly all the difficulty sits in the reader, because the two formats disagree
about how music is written down. MusicXML encodes time as a cursor that
`<backup>` and `<forward>` move around, spreads one voice across interleaved
elements, and links spanners by a `number` attribute that has to be matched
up. MNX states the same music directly.

The split also keeps a moving spec cheap, though not free: MNX has no stable
1.0, so when it changes, `write/` and `types/mnx.ts` move first, and the
model's MNX-spelled enums and the reader's unrepresentable registry move with
them where the change touches what they name.

## Modules

```
src/
  index.ts             the public API
  convert.ts           the pipeline: container, then read, then write
  container.ts         string, bytes, or an .mxl package into the XML to parse
  xml/                 element tree with source line numbers, typed accessors
  read/                MusicXML semantics, one file per concern
    score.ts           the score, its parts, and the walk through a measure
    attributes.ts      divisions, staves, key, time, clef
    notes.ts           a <note>: pitch, value, ties, slurs, accidentals
    voices.ts          the cursor, and one sequence per voice
    spanners.ts        joining the two ends of a tie or slur, and event ids
    beams.ts           per-note beam markings into MNX's tree of beams
    barlines.ts        barlines, repeat signs, and first and second endings
    directions.ts      dynamics, hairpins, octave shifts, tempo marks, segno
                       signs, Fines and jumps
    lyrics.ts          the words under a note
    duration.ts        note-value arithmetic, no XML in it
    divisions.ts       a <duration>, in the <divisions> in force
    noteValues.ts      MusicXML's note-type spellings, in the model's
    numbers.ts         reading a number stricter than Number() does
    element.ts         records which children a reader actually read
    unrepresentable.ts what MNX has nowhere to put
    state.ts           what a part carries between its measures
  model/               the score model both stages share
  write/               the MNX writer
  types/mnx.ts         MNX output types, exported
  fraction.ts          exact rational arithmetic for timing, never floats
  warnings.ts          the warning code registry
  errors.ts            MusicXMLError

cli/                   the Node command, outside src so the core stays Node-free
  run.ts               convert files, returning an exit code
  main.ts              wire argv and the console to run()
```

The command lives outside `src/` on purpose. The library core is isomorphic
and may touch neither Node nor DOM globals, which `tsconfig.json` enforces over
`src` alone; the command is a Node program and reads the filesystem freely, so
it sits in `cli/` and is type-checked with Node's types in the test pass. It
builds as its own self-contained `cli.js` (`vite.cli.config.ts`) so it shares
no chunks with the library bundle and carries the shebang the library must not.

The reader is the only part with much shape to it, and it is split so that
each file answers one question. `score.ts` holds the walk and nothing that can
be lifted off it, because the walk is the part that has to stay in document
order.

Stage boundaries are enforced by `no-restricted-imports` rules in
`eslint.config.js`, not left to discipline. A crossing is an architecture
change: amend this document first.

## The model

`model/` exists to decouple the two stages, and for nothing else. It is
internal, never exported, and scoped to conversion. It is not a general
notation model and should not grow into one: every concept added to it has to
earn its place by being something both a reader and a writer need.

Its types are deliberately narrow (`TimeUnit`, `ClefSign`, `Step`). That makes
validation the reader's job and lets the writer emit without a single cast. An
`as` in the writer would stand for an invariant nothing enforces, which is
exactly how a non-power-of-two time signature once reached the output.

## Errors and warnings

Two tiers, and the distinction is a contract rather than a style.

**Fatal**, a `MusicXMLError` carrying a document path and source line: input
that is structurally broken, or that cannot be converted faithfully. Rejecting
is better than guessing.

**Warning**, collected into the result: valid input the output does not carry.
Every one has a stable code and measure context, so a pipeline can tell a
lossless conversion from a lossy one. Dropping something silently is a bug by
definition.

The code's prefix splits warnings three ways, and the split is the report's
reason for existing rather than a nicety. `unsupported:` is a gap here, which
a later release may close. `unrepresentable:` is a limit of MNX, which no
release will close while the output format stays as it is. Anything else is
the source disagreeing with itself. Someone deciding whether a file is worth
reconverting after an upgrade needs those apart, and collapsing them into one
code makes the report unable to answer the question it was built for.

An element only counts as unrepresentable on a fact about the vendored schema:
there has to be no definition in it that could hold the element. The registry
is `read/unrepresentable.ts`, and calling something permanent when it is
merely unfinished is the worse error of the two.

Which of the two a reader is claiming is not left to the reader's memory
either. `read/element.ts` wraps an element and records which children were
actually read, and whatever is left over at the end is reported. The reason is
that the previous arrangement, a hand-kept set of "children handled at this
level", is a claim rather than a fact, and it drifted: it went on saying a
`<lyric>` was carried over long after the path that reads a chord member
stopped reading one. The only entries maintained by hand now are the
exceptions, where something is genuinely carried elsewhere and has to say so.

Fatal is all-or-nothing, deliberately. A document that hits something
unconvertible is refused whole rather than converted in part, because the
constructs that qualify are the ones that would make a measure fail to add up,
and a score with a wrong bar in it is worse than no score: a pipeline can see
that it got nothing, and cannot see that bar 41 is quietly wrong.

## Dependencies

At runtime, `@rgrove/parse-xml` for parsing and `fflate` for unpacking `.mxl`
packages, each with no dependencies of its own. `ajv` and the vendored schema
are dev-only for the library: the schema gate runs in the test suite, and the
command's `--validate`, which also uses them, is built as a self-contained
`cli.js` with `ajv` bundled in, so no install of the library pays for it.

The parser was chosen over the more widely used `saxes` mainly for safety on
untrusted input. It never processes DTDs, and treats an undefined entity as a
parse error rather than something to resolve, which closes off XXE and
entity-expansion attacks by construction. That is not theoretical: every
MusicXML file carries a DOCTYPE pointing at
`http://www.musicxml.org/dtds/partwise.dtd`, so a parser that resolved
external references would turn every conversion into a network fetch. It also
has zero dependencies, is actively maintained, and reports the character
offsets and error positions the location reporting needs.

The vendored MNX schema is the conformance oracle. Output with the shape a
test expected can still be illegal MNX, and the schema is the only thing that
knows the difference.

## Decisions worth remembering

- **The XML layer does not trim text.** Readers wanting a number or a keyword
  trim it themselves. Lyric text is meaningful down to the space, and once
  this layer has trimmed it there is no recovering it.
- **Attribute objects have a null prototype**, because attribute names come
  from the document. A plain object would let one named `constructor` be read
  back as an inherited function where a string was promised.
- **`MusicXMLError.path` is a `readonly string[]`**, not a display string, so
  callers can match a segment without parsing prose.
- **Type-checking runs twice**: `tsconfig.json` over `src`, and
  `tsconfig.test.json` over the tests. The tests are Node programs, but the
  library must touch neither Node nor DOM globals, and giving only the test
  pass those types enforces that rather than asserting it. Note that `exclude`
  is inherited through `extends`, so the test config clears it explicitly.
  Without that, tests beside the source go unchecked by both passes.
- **`fraction.ts` arrives with the timing work.** Nothing needed rational
  arithmetic while note values came straight from `<type>`.

## References

- MNX spec: https://w3c-cg.github.io/mnx/docs/
- MNX schema: https://github.com/w3c/mnx/blob/main/docs/mnx-schema.json
- MusicXML spec: https://www.w3.org/2021/06/musicxml40/
