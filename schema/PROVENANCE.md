# Vendored MNX schema

`mnx-schema.json` is the official MNX JSON Schema, copied here unmodified.

|                |                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | https://github.com/w3c/mnx, `docs/mnx-schema.json`                                                                                                                                          |
| Pinned commit  | `92f714347d3f721a4f61477cc9665b542ced9be1` ("Added way to encode number of staff lines.", 2026-09-08)                                                                                       |
| Retrieved      | 2026-09-12                                                                                                                                                                                  |
| SHA-256        | `40249ffaaea8ce3da47693d7aaf6e9e85243fe225de748c9333f4652029cce90`                                                                                                                          |
| Schema dialect | JSON Schema draft 2020-12                                                                                                                                                                   |
| Licence        | The MNX specification is published by the W3C Music Notation Community Group under the [W3C Community Final Specification Agreement](https://www.w3.org/community/about/agreements/final/). |

## Why it's vendored rather than fetched

MNX has no stable 1.0, and its schema changes as the Community Group settles
open questions. Pinning a specific commit means a conversion produced by a
given release of this package is checked against the exact rules that release
was written for. A spec change can never silently invalidate old output or
turn a green test suite red without a deliberate version bump.

## Integrity

`SHA256SUMS` records the checksum, and CI runs `sha256sum --check SHA256SUMS`
on every push. The schema is the conformance oracle for the entire test suite,
so a silent edit to it would weaken every gate at once.

Verify locally:

```bash
cd schema && sha256sum --check SHA256SUMS
```

## Updating the pin

Moving to a newer spec snapshot is a deliberate release, not a maintenance
chore:

1. Download the new `docs/mnx-schema.json` and update this file's commit,
   date, and checksum, then regenerate `SHA256SUMS`.
2. Run `pnpm exec vitest run tests/schema-conformance.test.ts`. It holds the
   three places that state something about MNX by hand to this file: the types
   in `src/types/mnx.ts`, the registry of what MNX cannot hold in
   `src/read/unrepresentable.ts`, and the id pattern in `src/read/score.ts`.
   Every failure is a decision to make, and the test says which.
3. Update `src/types/mnx.ts` to match any shape change the test reported. A
   field the schema gained and the types lack is never emitted, and the output
   stays legal, so nothing else catches it.
4. Run the same test again. Its fourth comparison is the model's MNX-spelled
   enums in `src/model/score.ts` against the types, so it has nothing to report
   until step 3 has moved the types. Carry each value the model states too into
   the model, or record the difference as deliberate, which is what the test
   asks for. A whole enum MNX has gained is reported the same way: pair it with
   a model enum, or state why the model does not restate it.
5. Move any entry the test reported out of `src/read/unrepresentable.ts` and
   into whatever now carries it. An element MNX has since gained a home for is
   a gap in this converter, not a limit of the format, and reporting it as
   permanent is the worse of the two errors.
6. Regenerate fixture goldens and review every diff, because a changed golden is a
   changed wire format, not a formality.
7. Re-run the corpus gate and record any movement in the warning baseline.
8. State the type changes in the release notes. The package exports every type
   in `src/types/mnx.ts`, so a shape the schema changed is a breaking change
   for anyone who names it.
