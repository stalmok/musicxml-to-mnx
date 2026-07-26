import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    // Library build: one self-contained ESM entry, consumed by bundlers. The
    // Node command is built separately (vite.cli.config.ts) so the two do not
    // share chunks and each stays a single file. `pnpm build` also emits the
    // .d.ts tree via tsc (see package.json / tsconfig.build).
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'ossia',
    },
    // The runtime dependencies stay external peers rather than being inlined,
    // so consumers dedupe them and get their security fixes without waiting
    // for a release here.
    rollupOptions: {
      external: ['@rgrove/parse-xml', 'fflate'],
    },
    // No sourcemaps in the published bundles: they roughly triple the tarball,
    // and local development runs against src, not dist.
    sourcemap: false,
  },
  test: {
    // Node environment: no DOM is involved anywhere in the conversion.
    environment: 'node',
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      // v8 = native coverage, no instrumentation step or extra Babel deps.
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      // Test files and type-only modules (erased at compile time, no runtime
      // to cover) would only add noise. cli/main.ts is the process wiring
      // around run(): it calls process.exit paths a subprocess smoke test
      // covers, not the in-process run() tests, so it is measured there
      // instead of here.
      exclude: ['src/**/*.test.ts', 'src/types/**', 'cli/main.ts'],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 98 },
    },
  },
})
