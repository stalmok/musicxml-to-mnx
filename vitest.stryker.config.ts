import { defineConfig } from 'vitest/config'
import { mnxValidatorPlugin } from './scripts/mnx-validator.ts'

// The test set the mutation run uses. Every mutant re-runs the tests that
// cover the mutated line, so only tests of a specific behaviour belong here:
//
//   - corpus.test.ts and corpus-full.test.ts convert every vendored song.
//     Running them once per mutant would take hours.
//   - performance.test.ts measures time. A mutant that only slows the
//     converter would read as killed.
//   - cli-artifact.test.ts spawns a subprocess per case and tests the
//     command wiring, not the reader.
//
// A mutant that only the corpus catches survives here: no focused test
// asserts the behaviour.
export default defineConfig({
  plugins: [mnxValidatorPlugin()],
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
