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
    // Tests convert, write and read through the helpers in tests/support,
    // which check what each produces. A call that a test expects
    // to throw stays direct: inside expect(() => ...).toThrow(), or as a
    // statement in a try block.
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^(convertMusicXML|writeMnx|readScore)$/]:not(CallExpression[callee.property.name=/^toThrow/] > MemberExpression.callee > CallExpression.object[callee.name="expect"] > ArrowFunctionExpression > CallExpression, TryStatement > BlockStatement.block > ExpressionStatement > CallExpression)',
          message:
            'Call convertValid or writeValid from tests/support/convert.ts, or readValid from tests/support/read.ts, which check what they produce.',
        },
        // The call check matches the functions by name, so a test must not
        // rename them or use them other than by a call.
        {
          selector:
            'ImportSpecifier[imported.name="convertMusicXML"][local.name!="convertMusicXML"], ImportSpecifier[imported.name="writeMnx"][local.name!="writeMnx"], ImportSpecifier[imported.name="readScore"][local.name!="readScore"]',
          message: 'Import convertMusicXML, writeMnx and readScore under their own names.',
        },
        {
          selector:
            'Identifier[name=/^(convertMusicXML|writeMnx|readScore)$/]:not(CallExpression > Identifier.callee, ImportSpecifier > Identifier, TSTypeQuery > Identifier)',
          message:
            'Call convertMusicXML, writeMnx and readScore directly, so the lint check sees the call.',
        },
      ],
    },
  },
  prettier, // must stay last, because it disables rules that conflict with Prettier
)
