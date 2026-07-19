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
              group: ['**/write/*', '**/types/mnx*'],
              message:
                'The reader produces the neutral score model, so it must not know the MNX output shape.',
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
              group: ['**/read/*', '**/xml/*'],
              message:
                'The writer consumes the neutral score model, so it must not know MusicXML or the XML layer.',
            },
          ],
        },
      ],
    },
  },
  {
    // The model is the boundary object both stages share: it depends on
    // neither of them, which is what keeps it a boundary.
    files: ['src/model/**', 'src/xml/**', 'src/types/**'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/read/*', '**/write/*', '../convert.js'],
              message: 'Leaf modules must not import stage implementations.',
            },
          ],
        },
      ],
    },
  },
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
