# Architecture

How the converter is put together. For usage and current capability, see the
README.

## Shape

Two stages, with a shared model between them. MusicXML knowledge stops at the
reader, and MNX knowledge starts at the writer. That is an import boundary,
not a knowledge boundary. The reader never sees the MNX types, and the writer
never sees the XML layer, but the model stays near to MNX on purpose. Its
enums use the MNX spellings, therefore the writer needs no second table. The
reader owns the registry of what MNX cannot hold
(`read/unrepresentable.ts`), because a loss report needs the source line and
the measure context. Only the reader has these.

```
MusicXML string or bytes
  -> xml/    parse into a light element tree that carries line numbers
  -> read/   MusicXML semantics into the score model
  -> write/  score model into MNX JSON
  -> { mnx, warnings }
```

Almost all of the difficulty is in the reader, because the two formats do not
agree about how to write music down. MusicXML encodes time as a cursor, and
`<backup>` and `<forward>` move that cursor. It spreads one voice across
elements that interleave. It links spanners by a `number` attribute that the
reader must match. MNX states the same music directly.

The split also keeps a moving spec cheap, but not free. MNX has no stable
1.0. When MNX changes, `write/` and `types/mnx.ts` change first. The
MNX-spelled enums in the model and the unrepresentable registry in the reader
change with them, if the change touches what they name.

## Modules

```
src/
  index.ts             the public API
  convert.ts           the pipeline: container, then read, then write
  container.ts         gets the XML from a string, bytes, or an .mxl package
  xml/                 element tree with source line numbers, typed accessors
  read/                MusicXML semantics, one file for each concern
    score.ts           reads the score and its parts, and walks a measure
    part-groups.ts     makes the instrument grouping tree from <part-group>
    attributes.ts      reads divisions, staves, key, time, clef, and measure
                       style (multi-measure rests, measure repeats)
    notes.ts           reads a <note>: pitch, value, ties, slurs, accidentals
    voices.ts          moves the cursor and makes one sequence for each voice
    spanners.ts        joins the two ends of a tie, slur, hairpin, or octave
                       shift, and makes event ids
    beams.ts           makes the MNX tree of beams from per-note beam marks
    barlines.ts        reads barlines, repeat signs, and first and second
                       endings
    print.ts           reads the system breaks and page breaks in <print>
    directions.ts      reads dynamics, hairpins, octave shifts, tempo marks,
                       segno signs, Fines, and jumps
    lyrics.ts          reads the words under a note
    duration.ts        note-value arithmetic, with no XML in it
    divisions.ts       reads a <duration> in the <divisions> in force
    noteValues.ts      changes MusicXML note types into the model's
    numbers.ts         reads a number more strictly than Number() does
    color.ts           changes MusicXML #RRGGBB and #AARRGGBB into MNX color
    element.ts         records which children a reader read
    unrepresentable.ts lists what MNX cannot hold
    state.ts           holds what a part carries between its measures
  model/               the score model that both stages share
  write/               the MNX writer
  types/mnx.ts         the MNX output types, exported
  fraction.ts          exact rational arithmetic for timing, never floats
  warnings.ts          the registry of warning codes
  errors.ts            MusicXMLError

cli/                   the Node command, outside src to keep the core free of
                       Node
  run.ts               converts files and returns an exit code
  main.ts              connects argv and the console to run()
```

The command is outside `src/` on purpose. The library core is isomorphic, and
it must touch no Node global and no DOM global. `tsconfig.json` enforces this
over `src` alone. The command is a Node program that reads the file system,
therefore it sits in `cli/`. The test pass type-checks it with the Node
types. It builds as its own self-contained `cli.js`
(`vite.cli.config.ts`). Therefore it shares no chunks with the library
bundle, and it carries the shebang that the library must not have.

The reader has the most structure, and it is split so that each file answers
one question. `score.ts` holds the walk and nothing that can move off it,
because the walk must stay in document order.

Rules in `.dependency-cruiser.js` enforce the stage boundaries
(`pnpm deps:check`). They are not left to discipline. A crossing is an
architecture change: change this document first.

That file is the only other place that records the boundaries. This is why
they are rules and not prose in a second document. It states each rule
against resolved module paths, therefore an `import type` across a stage line
counts the same as a value import. It also adds the checks that a per-file
linter cannot make: no cycles, no file that an entry point cannot reach, no
core module in the isomorphic library, and no dev-only dependency in what
ships.

## The model

`model/` exists to decouple the two stages, and for nothing else. It is
internal, it is never exported, and its scope is conversion. It is not a
general notation model, and it must not become one. Each concept in it must
be something that both a reader and a writer need.

Its types are narrow on purpose (`TimeUnit`, `ClefSign`, `Step`). Therefore
validation is the work of the reader, and the writer emits with no cast. An
`as` in the writer would stand for an invariant that nothing enforces. That
is how a non-power-of-two time signature reached the output one time.

## Errors and warnings

There are two levels, and the difference is a contract, not a style.

**Fatal**, a `MusicXMLError` that carries a document path and a source line:
the input has a broken structure, or the converter cannot convert it
faithfully. To reject is better than to guess. The reader keeps few
heuristics. Each heuristic is documented, and it reports a warning when it
fires.

**Warning**, collected into the result: the input is valid, but the output
does not carry it. Each warning has a stable code and measure context,
therefore a pipeline can tell a lossless conversion from a lossy one. To drop
something silently is a bug by definition.

The prefix of the code splits warnings three ways, and the split is the
reason the report exists. `unsupported:` is a gap here, which a later release
can close. `unrepresentable:` is a limit of MNX, which no release closes
while the output format stays the same. All other prefixes show that the
source disagrees with itself. A person who decides if a file is worth a
second conversion after an upgrade needs those three apart. One code for all
three makes the report unable to answer the question that it was built for.

An element counts as unrepresentable only on a fact about the vendored
schema: the schema must have no definition that could hold the element. The
registry is `read/unrepresentable.ts`. To call a loss permanent when it is
only unfinished is the worse of the two errors.

A test checks that fact instead of remembering it. The schema is the oracle
for the output, and nothing held the beliefs of the converter about MNX to it
before the converter wrote anything. The registry above, the MNX types, and
the id pattern that the reader renames parts by are each a copy of something
in the schema. `tests/schema-conformance.test.ts` compares all three with the
schema, and each entry in the registry states the fact that it rests on. The
MNX-spelled enums in the model are a fourth copy, of the types and not of the
schema. The same test compares them with the types, therefore they reach the
schema through the types. That comparison is accounted for from both ends.
Each enum that the model states is paired with an MNX enum, or it says why it
is not one. Each enum that MNX states is reached by a pairing, or it says why
the model does not restate it. Both ways of being wrong are otherwise silent.
A field that the types do not have is never emitted, and the output stays
legal. A stale registry entry continues to call a loss permanent.

Which of the two a reader claims is not left to the memory of the reader
either. `read/element.ts` wraps an element and records which children it read.
It reports whatever is left at the end. The previous arrangement was a set of
"children handled at this level" kept by hand. That is a claim and not a
fact, and it drifted. It went on saying that a `<lyric>` was
carried, long after the path that reads a chord member no longer read one.
The only entries that a person maintains now are the exceptions, where
something is genuinely carried in another place and must say so.

Fatal is all or nothing, on purpose. If a document holds something that the
converter cannot convert, the converter refuses the whole document. It does
not convert a part of it. The constructs that qualify are the ones that would
make a measure fail to add up. A score with a wrong bar in it is worse than
no score: a pipeline can see that it got nothing, and it cannot see that bar
41 is quietly wrong.

## Dependencies

At run time, the library uses `@rgrove/parse-xml` to parse and `fflate` to
unpack `.mxl` packages. Neither has dependencies of its own. `ajv` and the
vendored schema are dev-only for the library. The schema gate runs in the
test suite. The `--validate` option of the command also uses them, but the
command builds as a self-contained `cli.js` with `ajv` inside it. Therefore
no install of the library pays for it.

This parser was chosen over the more widely used `saxes` mainly for safety on
untrusted input. It never processes DTDs, and it treats an undefined entity
as a parse error instead of something to resolve. That closes off XXE attacks
and entity-expansion attacks by construction. The risk is not theoretical:
each MusicXML file carries a DOCTYPE that points at
`http://www.musicxml.org/dtds/partwise.dtd`, therefore a parser that resolved
external references would turn each conversion into a network fetch. The
parser also has zero dependencies, has active maintenance, and reports the
character offsets and error positions that the location reports need.

The vendored MNX schema is the conformance oracle. Output with the shape that
a test expected can still be illegal MNX, and only the schema knows the
difference.

## Performance

Tests guard the conversion time. `tests/performance.test.ts` converts
generated scores at two sizes along each axis: measures, parts, and notes in
a measure. The test fails when the time ratio comes near to quadratic. The
generator behind those scores is itself tested for lossless, schema-valid
output. `pnpm bench` times each pipeline stage and whole conversions.

## Decisions worth remembering

- **The XML layer does not trim text.** `element.text` is raw. A reader that
  wants a number or a keyword opts in through `trimmedText()`. Lyric text is
  meaningful down to the space, and after this layer trims it there is no way
  to recover it.
- **Attribute objects have a null prototype**, because attribute names come
  from the document. With a plain object, an attribute named `constructor`
  could read back as an inherited function where a string was promised.
- **`MusicXMLError.path` is a `readonly string[]`**, not a display string,
  therefore a caller can match a segment without parsing prose.
- **Type-checking runs two times**: `tsconfig.json` over `src`, and
  `tsconfig.test.json` over the tests. The tests are Node programs, but the
  library must touch no Node global and no DOM global. Only the test pass
  gets those types, which enforces the rule instead of asserting it. Note
  that `exclude` is inherited through `extends`, therefore the test config
  clears it. Without that, the tests beside the source get no check from
  either pass.
- **`fraction.ts` arrives with the timing work.** Nothing needed rational
  arithmetic while note values came straight from `<type>`.

## References

- MNX spec: https://w3c-cg.github.io/mnx/docs/
- MNX schema: https://github.com/w3c/mnx/blob/main/docs/mnx-schema.json
- MusicXML spec: https://www.w3.org/2021/06/musicxml40/
