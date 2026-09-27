import { defineConfig } from 'vite'
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.ts'

// The `musicxml-to-mnx` command, built as its own self-contained file so it shares no
// chunks with the library bundle. Run after the library build with
// emptyOutDir off, so it adds cli.js beside musicxml-to-mnx.js rather than wiping it.
export default defineConfig({
  // Ajv and its dependencies are inlined, and their licences require the notice.
  plugins: [thirdPartyNoticesPlugin('THIRD_PARTY_NOTICES.txt')],
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
    // No sourcemaps in the published bundles: they roughly triple the tarball,
    // and local development runs against src, not dist.
    sourcemap: false,
  },
})
