// Flat config. Basic, non-type-checked TypeScript linting: fast and
// dependency-light. tsc (pnpm typecheck) owns type correctness; ESLint owns
// lint-level code smells; Prettier owns formatting.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // Hidden directories hold tooling and local state, never library source.
  { ignores: ['dist', 'node_modules', 'coverage', '**/.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // tsc owns unused-symbol checking via noUnusedLocals + noUnusedParameters
      // (which honour the _-prefix convention), so this rule stays off to avoid
      // double-reporting the same smell.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // Stage boundaries: xml → read → model → write, with types as a leaf. The
  // whole point of the two-stage design is that MusicXML knowledge stops at
  // the reader and MNX knowledge starts at the writer; a crossing here is an
  // architecture change, so amend the design doc first.
  {
    files: ['src/read/**'],
    ignores: ['src/read/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/write/*', '**/types/mnx*', '../convert.js', '../container.js'],
              message:
                'The reader produces the neutral score model, so it must not know the MNX output shape, the pipeline, or the packaging layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/write/**'],
    ignores: ['src/write/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/read/*', '**/xml/*', '../convert.js', '../container.js'],
              message:
                'The writer consumes the neutral score model, so it must not know MusicXML, the XML layer, the pipeline, or the packaging layer.',
            },
          ],
        },
      ],
    },
  },
  {
    // The model is the boundary object both stages share: it depends on
    // neither of them, and not on the MNX types either, which is what keeps
    // it a boundary.
    files: ['src/model/**'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/read/*',
                '**/write/*',
                '**/types/*',
                '**/xml/*',
                '../convert.js',
                '../container.js',
              ],
              message:
                'The model depends on neither stage, the MNX types, nor the XML layer; that is what keeps it a boundary.',
            },
          ],
        },
      ],
    },
  },
  {
    // Generic leaves: the XML layer knows no music, and the MNX types know
    // only the wire format. Neither may reach back into the pipeline.
    files: ['src/xml/**', 'src/types/**'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/read/*', '**/write/*', '**/model/*', '../convert.js', '../container.js'],
              message: 'Leaf modules must not import stage implementations or the model.',
            },
          ],
        },
      ],
    },
  },
  {
    // The command is a consumer of the library, not a fourth stage: it goes
    // through the public API alone, like any other user of the package.
    files: ['cli/**'],
    ignores: ['cli/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../src/**', '!../src/index.js'],
              message: 'The command uses the library through its public API (src/index.js) only.',
            },
          ],
        },
      ],
    },
  },
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
