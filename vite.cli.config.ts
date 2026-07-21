import { defineConfig } from 'vite'

// The `mnxml` command, built as its own self-contained file so it shares no
// chunks with the library bundle. Run after the library build with
// emptyOutDir off, so it adds cli.js beside mnxml.js rather than wiping it.
export default defineConfig({
  build: {
    lib: {
      entry: 'cli/main.ts',
      formats: ['es'],
      fileName: () => 'cli.js',
    },
    // Do not wipe the library build that ran first.
    emptyOutDir: false,
    rollupOptions: {
      // The runtime dependencies and Node's built-ins stay external. Ajv,
      // reached only by --validate, is bundled in, so it stays a dev
      // dependency rather than one every install of the library pays for.
      external: ['@rgrove/parse-xml', 'fflate', /^node:/],
      output: {
        // A shebang so the file runs directly. The library must never carry
        // one, which is why the two builds are separate.
        banner: '#!/usr/bin/env node',
      },
    },
    sourcemap: true,
  },
})
