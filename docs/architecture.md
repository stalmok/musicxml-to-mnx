# Architecture

ossia converts MusicXML into MNX through an internal score model.
The reader handles MusicXML semantics. The writer produces MNX objects.
See the [README](../README.md) for usage and supported notation.

## Data flow

```text
MusicXML string or bytes
  -> container.ts  decode XML or extract it from an .mxl archive
  -> xml/          parse XML and retain source positions
  -> read/         build the internal score model
  -> write/        produce MNX from the model
  -> { mnx, warnings }
```

`convert.ts` runs this pipeline synchronously. It processes the whole document
in memory. A fatal error returns no partial result.

## Module boundaries

| Module             | Responsibility                                                     |
| ------------------ | ------------------------------------------------------------------ |
| `src/index.ts`     | Export the public conversion API, errors, warnings, and MNX types. |
| `src/container.ts` | Decode input bytes and select the score from an archive.           |
| `src/xml/`         | Parse XML and provide typed tree access with source positions.     |
| `src/read/`        | Interpret MusicXML and build the score model.                      |
| `src/model/`       | Define the internal score model shared by reader and writer.       |
| `src/write/`       | Turn the score model into MNX.                                     |
| `src/types/mnx.ts` | Define the public MNX output types.                                |
| `src/fraction.ts`  | Provide exact rational arithmetic.                                 |
| `src/warnings.ts`  | Define warning codes, categories, and collection.                  |
| `src/errors.ts`    | Define `MusicXMLError` and its location fields.                    |
| `src/ids.ts`       | Define MNX's id pattern and the ids the converter generates.       |
| `cli/`             | Handle files and command options through the public API.           |

[Dependency rules](../.dependency-cruiser.js) enforce these boundaries for
value imports and type imports:

- The reader cannot import the writer, MNX types, or input pipeline.
- The writer cannot import the reader, XML layer, or input pipeline.
- The model cannot import either stage, XML, MNX types, or the input pipeline.
- The XML layer and MNX types cannot import the stages, model, or input pipeline.
- `errors.ts`, `warnings.ts`, `fraction.ts`, and `ids.ts` cannot import the
  stages, model, XML layer, MNX types, or input pipeline.
- `src/index.ts` cannot import the internal model.
- The CLI accesses `src/` through `src/index.ts`.
- The library cannot import the CLI, Node core modules, or development dependencies.

The same checks detect cycles, unresolved imports, and unreachable source files.
Run `pnpm deps:check` to check the import graph.
Update this document before changing a stage boundary.

## Internal score model

The model contains only concepts needed for conversion. It is not part of
the public API: `src/index.ts` does not export it, and the package does not
ship its declarations.

The model is MNX-shaped, not neutral. It follows the MNX structure closely:

- The score holds `globalMeasures`. They follow MNX's global measure. They also
  carry multimeasure rests and system and page breaks, which MNX states elsewhere.
- `Markings` is keyed by marking kind, and the kinds use MNX spellings.
- A full-measure rest belongs to the sequence, as in MNX.
- Beams belong to the measure, as in MNX.
- `GraceType`, `JumpType`, and `Space` follow their MNX definitions.
  `Transposition` follows MNX closely.
- A segno color uses MNX's `#RRGGBB` form.

The stage boundary is narrower than a neutral model. It means two things:

- No MusicXML encoding passes the reader. The model holds no divisions,
  `<backup>` cursors, or spanner `number` attributes.
- The reader imports no MNX types. It produces the model.

The model uses narrow types for values such as pitch steps, clefs, and time
units. The reader checks input values before constructing these types.
The writer relies on those checked values.

Because the model follows MNX, a schema change can require model and reader
changes as well as writer changes.

## Reader

MusicXML represents time with a cursor. Notes advance it, `<backup>` moves it
back, and `<forward>` moves it ahead. Events from different voices can
interleave in document order.

The reader tracks durations with exact fractions of the active divisions.
It assigns events to voices and staves, and carries state between measures.
It resolves ties, slurs, and other spans across measures.

The reader modules are:

| Module                        | Responsibility                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `score.ts`                    | Read parts and walk measures in document order.                                |
| `attributes.ts`               | Read divisions, staves, keys, time signatures, clefs, and measure styles.      |
| `notes.ts`                    | Read notes and their notation.                                                 |
| `voices.ts`                   | Track the cursor and assemble voice events.                                    |
| `rests.ts`                    | Decide whether a rest is its voice's measure rest, and in what form.           |
| `tuplets.ts`                  | Track tuplet ratios and settle tuplet brackets when the measure is complete.   |
| `lyrics.ts`                   | Read lyrics for each verse.                                                    |
| `spanners.ts`                 | Resolve ties, slurs, hairpins, and octave shifts.                              |
| `idGenerator.ts`              | Generate event, note, and kit component IDs.                                   |
| `beams.ts`                    | Assemble beam groups.                                                          |
| `directions.ts`               | Read dynamics, tempo marks, and navigation signs.                              |
| `jumps.ts`                    | Match each dal segno jump to its segno, and settle it as D.S. or D.S. al Fine. |
| `barlines.ts`                 | Read barlines, repeats, and endings.                                           |
| `part-groups.ts`, `print.ts`  | Read part groups and layout breaks.                                            |
| `transposition.ts`            | Convert written pitches and keys of transposing parts to sounding pitch.       |
| `divisions.ts`, `duration.ts` | Read durations in divisions. Convert a duration back to a note value.          |
| `noteValues.ts`               | Map MusicXML note-type names to model note values.                             |
| `numbers.ts`                  | Read whole and decimal numbers strictly, and check ranges.                     |
| `color.ts`                    | Read MusicXML colors into MNX color strings.                                   |
| `tables.ts`                   | Provide typed helpers for tables keyed by model unions.                        |
| `element.ts`                  | Track consumed XML content and report unhandled content.                       |
| `unrepresentable.ts`          | Record notation that the pinned MNX schema cannot express.                     |
| `state.ts`                    | Hold state shared across measures in a part.                                   |
| `draft.ts`                    | Give a model shape without readonly, for a builder to fill.                    |

### Note assembly order

`notes.ts` calls `MeasureBuilder` in `voices.ts`. Chord members join an existing
event through a separate path before group opening. They do not open groups.

For a new event, the call order is:

1. Open tuplets, then tremolo groups.
2. Add the note to its voice.
3. Attach notation that refers to the event.
4. Close tremolo groups, then tuplets.

Preserve this order when changing note handling. Nested groups and chord
members depend on it.

## Errors and warnings

A `MusicXMLError` stops conversion. Causes include malformed XML, invalid
values, and score structures the converter cannot handle.

The error carries a document path and a source line when available.
Document-level errors can have an empty path and no line.
The conversion entry point adds the caller's `documentName`, if supplied.

Warnings allow conversion to continue. They report omitted notation,
source inconsistencies, and corrections made by the reader.
Each warning has a stable code and the available source context.

`unsupported:` identifies a converter gap. `unrepresentable:` identifies a
limitation of the pinned MNX schema. Other prefixes identify source problems
or reported corrections.

These categories describe the current result. They do not guarantee that a
future release will produce the same warnings or refuse the same files.

`read/element.ts` records consumed children and attributes. Unhandled content
is reported through the warning system. Content handled elsewhere needs an
explicit exception.

The reader owns the unrepresentable-element registry because it has the XML
context needed for warnings. Registry entries must have a basis in the
vendored schema.

## Schema and validation

The vendored schema defines the accepted MNX output format.
Every conversion output in tests must validate against it.
The library does not run schema validation during conversion.
The CLI provides optional validation through `--validate`.

`tests/schema-conformance.test.ts` checks:

- The public MNX types against the schema.
- The unrepresentable-element registry against schema capabilities.
- Generated-ID constraints against the schema's ID pattern.
- Model enums against the corresponding MNX enums, with explicit exceptions.

Follow the [schema update procedure](../schema/PROVENANCE.md) when changing the pin.
Review affected types, model values, reader behavior, writer output, and corpus results.

Corpus tests also compare pitches and measure lengths with the source.
They skip length comparisons for files with `inconsistent:duration` warnings.
Conversion refusals are distinct from crashes and failed output checks.

## Runtime and packaging

The core library supports browsers and Node. It uses no Node or DOM globals.
`tsconfig.json` omits those platform types. Dependency rules also prohibit
Node core imports in the library. `tests/isomorphic-artifact.test.ts` runs the
built library, with its dependencies, in a V8 context that holds no Node or
browser globals.

CI runs the test suite on Node 24 and on the lowest Node 20 and 22 versions
that the `engines` field allows. `tests/node-versions.test.ts` checks the CI
versions against the `engines` field.

`tsconfig.test.json` adds Node types for tests and the CLI.
`pnpm typecheck` runs both configurations.

The library uses `@rgrove/parse-xml` for XML and `fflate` for archive extraction.
Both remain external dependencies in the builds.

The library builds to `dist/musicxml-to-mnx.js`. The CLI builds separately to
`dist/cli.js`, with its own shebang and no shared application chunks.
TypeScript declarations are emitted under `dist/types/`.
`scripts/prune-declarations.ts` then removes every declaration that
`index.d.ts` does not reach, so no internal module is shipped.
`tests/declarations-artifact.test.ts` checks the shipped set and compiles a
consumer against it.

Ajv is bundled into the CLI for validation. It is not imported by the library,
but the CLI bundle is included in the installed package.

## Input handling and invariants

- The XML parser does not process DTDs or resolve external entities.
- Undefined entities cause parse errors.
- XML text remains untrimmed. Readers use `trimmedText()` for numbers and keywords.
- Attribute objects have null prototypes.
- Raw bytes follow a byte-order mark (UTF-8 or UTF-16) first, then the encoding in the XML declaration, then UTF-8.
- The converter reads two declared encodings: UTF-8 and windows-1252. ISO-8859-1 and US-ASCII labels decode as windows-1252, as the Encoding Standard maps them. A UTF-16 label with no byte-order mark decodes as UTF-8.
- Any other declared encoding causes a `MusicXMLError`. A document read as UTF-8 that is not valid UTF-8 also causes one.
- Archive extraction selects the score named by the container listing.
- If the listing does not identify an existing entry, a single XML score file can be used instead.
- Raw input length and selected entries' declared sizes are checked against `100 * 1024 * 1024`.

The length check uses bytes for byte input and archive sizes.
It uses UTF-16 code units for string input.
The whole-document pipeline also allocates an XML tree, score model, and MNX output.

## Performance checks

`tests/performance.test.ts` compares conversion times at two sizes for
measure count, part count, and notes per measure. It checks for excessive
growth in runtime rather than a fixed conversion speed.

`pnpm bench` measures individual pipeline stages and complete conversions.
