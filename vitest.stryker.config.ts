import { defineConfig } from 'vitest/config'

// The test set the mutation run uses. Every mutant re-runs the tests that
// cover the mutated line, so what belongs here is the tests that assert a
// specific behaviour, not the ones that sweep breadth:
//
//   - corpus.test.ts and corpus-full.test.ts convert every vendored song.
//     They are a regression net over real music, and running them once per
//     mutant would turn minutes into hours.
//   - performance.test.ts measures time, so a mutant that only slows the
//     converter down would read as killed for the wrong reason.
//   - cli-artifact.test.ts spawns a subprocess per case and exercises the
//     command wiring, not the reader.
//
// A mutant that only the corpus would catch therefore survives here. That is
// the reading we want: it means no focused test asserts the behaviour.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'cli/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/corpus.test.ts',
      'tests/corpus-full.test.ts',
      'tests/performance.test.ts',
      'tests/cli-artifact.test.ts',
    ],
  },
})
