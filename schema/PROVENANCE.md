# Vendored MNX schema

`mnx-schema.json` is the official MNX JSON Schema, copied here unmodified.

|                |                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | https://github.com/w3c-cg/mnx, `docs/mnx-schema.json`                                                                                                                                                |
| Pinned commit  | `0be1b2a7d0f623b3cf3a7d41d4fbb16dbcc07f2a` ("Refactored how dynamics are represented in the JSON Schema.", 2026-09-29)                                                                               |
| Retrieved      | 2026-10-03                                                                                                                                                                                           |
| SHA-256        | `a0a3f0c7695be7a0cef07e106c7daa2c57df5cdbdc3da1702fded299ecc07be7`                                                                                                                                   |
| Schema dialect | JSON Schema draft 2020-12                                                                                                                                                                            |
| Licence        | The MNX specification is a draft published by the W3C Music Notation Community Group under the [W3C Community Contributor License Agreement (CLA)](https://www.w3.org/community/about/process/cla/). |

## Why it's vendored rather than fetched

MNX has no stable 1.0, and its schema changes as the Community Group settles
open questions. The pin checks each release against the schema it was written
for. A schema change reaches this package only through a new release.

## Integrity

`SHA256SUMS` records the checksum, and CI runs `sha256sum --check SHA256SUMS`
on every push.

Verify locally:

```bash
cd schema && sha256sum --check SHA256SUMS
```

## Updating the pin

Moving to a newer spec snapshot is a release:

1. Download the new `docs/mnx-schema.json` and update this file's commit,
   date, and checksum, then regenerate `SHA256SUMS`.
2. Run `pnpm exec vitest run tests/schema-conformance.test.ts`. It holds the
   places that state something about MNX by hand to this file: the types in
   `src/types/mnx.ts`, the registry of what MNX cannot hold in
   `src/read/unrepresentable.ts`, the id pattern in `src/ids.ts`, and the
   numeric limits the reader keeps to.
   Each failure names the decision to make.
3. Update `src/types/mnx.ts` to match any shape change the test reported. No
   other check finds a field the schema gained and the types lack.
4. Run the same test again. Its fourth comparison is the model's MNX-spelled
   enums in `src/model/score.ts` against the types, so it has nothing to report
   until step 3 has moved the types. Carry each value the model states too into
   the model, or record the difference as deliberate. A whole enum MNX has
   gained is reported the same way: pair it with a model enum, or state why
   the model does not restate it.
5. Move any entry the test reported out of `src/read/unrepresentable.ts` and
   into whatever now carries it. An element MNX can now hold is a gap in this
   converter, not a limit of the format.
6. Regenerate fixture goldens and review every diff. A changed golden is a
   changed wire format.
7. Re-run the corpus gate and record any movement in the warning baseline.
8. State the type changes in the version's
   [GitHub release](https://github.com/stalmok/musicxml-to-mnx/releases) notes. The package exports every type
   in `src/types/mnx.ts`, so a changed type is a breaking change.
