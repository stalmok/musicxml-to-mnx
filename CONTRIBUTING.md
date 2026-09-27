# Contributing

## Report a bug

Open an issue with the bug-report form. Attach the MusicXML file that shows
the problem, or a smaller file that shows the same problem. Include the
warnings the conversion returned.

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Change the code

Read the [architecture](docs/architecture.md) and the
[working conventions](AGENTS.md) first. The [Development](README.md#development)
section lists the setup and the checks.

Run `pnpm hooks:install` once per clone. The pre-commit hook runs the type
check, lint, the import-graph check, the format check and the test suite
without the vendored corpus. All must pass.

A pull request must:

- Validate every conversion output in its tests against the vendored MNX
  schema. Tests convert through `convertValid` and `writeValid` in
  `tests/support/convert.ts`.
- Emit a `ConversionWarning` for notation it cannot convert. Never drop
  notation without a warning.
- Keep test coverage at 98% or more.
- Run `pnpm test:corpus` if it changes the reader, the model or the writer.

Run `pnpm audit` after you install or update a package, and resolve its
findings before you commit.

Keep each commit to one logical change.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
