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
  {
    // Every conversion output in a test is held to the schema. The helpers in
    // tests/support/convert.ts do that on every call, so a test calls them.
    // A call a test expects to throw has no output to check, and stays direct:
    // inside expect(() => ...).toThrow(), or as a statement in a try block.
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^(convertMusicXML|writeMnx)$/]:not(CallExpression[callee.property.name=/^toThrow/] > MemberExpression.callee > CallExpression.object[callee.name="expect"] > ArrowFunctionExpression > CallExpression, TryStatement > BlockStatement.block > ExpressionStatement > CallExpression)',
          message:
            'Call convertValid or writeValid from tests/support/convert.ts, which check the output against the MNX schema.',
        },
      ],
    },
  },
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
