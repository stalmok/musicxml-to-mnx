// Non-type-checked TypeScript linting. tsc (pnpm typecheck) owns type
// correctness, Prettier owns formatting, and dependency-cruiser
// (pnpm deps:check) owns the import graph.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', '**/.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // tsc checks unused symbols with noUnusedLocals and noUnusedParameters,
      // which honour the _-prefix convention.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Tests convert and write through the helpers in tests/support/convert.ts,
    // which check every output against the schema. A call that a test expects
    // to throw stays direct: inside expect(() => ...).toThrow(), or as a
    // statement in a try block.
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
        // The call check matches the functions by name, so a test must not
        // rename them or use them other than by a call.
        {
          selector:
            'ImportSpecifier[imported.name="convertMusicXML"][local.name!="convertMusicXML"], ImportSpecifier[imported.name="writeMnx"][local.name!="writeMnx"]',
          message: 'Import convertMusicXML and writeMnx under their own names.',
        },
        {
          selector:
            'Identifier[name=/^(convertMusicXML|writeMnx)$/]:not(CallExpression > Identifier.callee, ImportSpecifier > Identifier, TSTypeQuery > Identifier)',
          message: 'Call convertMusicXML and writeMnx directly, so the schema check sees the call.',
        },
      ],
    },
  },
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
