// Flat config. Basic, non-type-checked TypeScript linting: fast and
// dependency-light. tsc (pnpm typecheck) owns type correctness; ESLint owns
// lint-level code smells; Prettier owns formatting; dependency-cruiser
// (pnpm deps:check) owns the import graph, stage boundaries included.

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
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
