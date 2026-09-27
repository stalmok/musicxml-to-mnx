# Security policy

## Supported versions

Only the latest release gets security fixes.

## Report a vulnerability

Do not open a public issue for a vulnerability.
Report it privately through GitHub:

1. Open the [Security tab](https://github.com/stalmok/musicxml-to-mnx/security) of this repository.
2. Select **Report a vulnerability**.
3. Describe the problem and the input that causes it. Attach a minimal file if you can.

You get a reply within 7 days.

## Scope

The converter reads untrusted MusicXML. These are in scope:

- The parser resolves an external entity or a DTD, or reads a file or URL.
- An input causes memory use or run time out of proportion to its size.
- An input bypasses the input size limit or the archive entry limit.
- An `.mxl` archive causes the converter to read outside the archive.
- An input makes the converter hang.

Output that is wrong but legal MNX is a conversion bug, not a vulnerability.
Report it as a normal issue.

[Input handling](README.md#input-handling) describes the limits the converter enforces.
