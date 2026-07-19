import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // Library build: one ESM entry, consumed by bundlers. `pnpm build` also
    // emits the matching .d.ts tree via tsc (see package.json / tsconfig.build).
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'mnxml',
    },
    // The XML parser stays an external peer rather than being inlined, so
    // consumers dedupe it and get its security fixes without waiting for a
    // release here.
    rollupOptions: {
      external: ['@rgrove/parse-xml'],
    },
    sourcemap: true,
  },
  test: {
    // Node environment: no DOM is involved anywhere in the conversion.
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      // v8 = native coverage, no instrumentation step or extra Babel deps.
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Test files and type-only modules (erased at compile time, no runtime
      // to cover) would only add noise.
      exclude: ['src/**/*.test.ts', 'src/types/**'],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 95 },
    },
  },
})
