# Vendored MNX schema

`mnx-schema.json` is the official MNX JSON Schema, copied here unmodified.

|                |                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | https://github.com/w3c/mnx, `docs/mnx-schema.json`                                                                                                                                          |
| Pinned commit  | `bd9e611aca10f5571cf8f0c1be49629099584a4b` ("Added measure repeats.", 2026-07-28)                                                                                                           |
| Retrieved      | 2026-08-07                                                                                                                                                                                  |
| SHA-256        | `71cce118e2bb4d17d42790db2574e84e2b7ba0f0be020c866f71b8f89b638fb8`                                                                                                                          |
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
2. Update `src/types/mnx.ts` to match any shape changes.
3. Regenerate fixture goldens and review every diff, because a changed golden is a
   changed wire format, not a formality.
4. Re-run the corpus gate and record any movement in the warning baseline.
