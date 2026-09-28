import { defineConfig } from 'vite'
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.ts'

// The `musicxml-to-mnx` command, built as a self-contained file that shares no
// chunks with the library bundle. It runs after the library build and adds
// cli.js beside musicxml-to-mnx.js.
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
      // The runtime dependencies and Node's built-ins stay external. Ajv is
      // used only by --validate. It is bundled in so that it stays a dev
      // dependency of the library.
      external: ['@rgrove/parse-xml', 'fflate', /^node:/],
      output: {
        // The library must not have a shebang, so the two builds are separate.
        banner: '#!/usr/bin/env node',
      },
    },
    // Sourcemaps roughly triple the tarball, and local development runs
    // against src.
    sourcemap: false,
  },
})
