import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // One self-contained ESM entry. vite.cli.config.ts builds the Node command
    // separately, so the two share no chunks. `pnpm build` also emits the .d.ts
    // tree with tsc.
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'musicxml-to-mnx',
    },
    // The runtime dependencies stay external, so consumers dedupe them and get
    // their security fixes without a release of this package.
    rollupOptions: {
      external: ['@rgrove/parse-xml', 'fflate'],
    },
    // Sourcemaps roughly triple the tarball, and local development runs
    // against src.
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      // Type-only modules have no runtime code. cli/main.ts is the process
      // wiring around run(). tests/cli-artifact.test.ts runs it as a
      // subprocess.
      exclude: ['src/**/*.test.ts', 'src/types/**', 'cli/main.ts'],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 98 },
    },
  },
})
