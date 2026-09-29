// The validator the plugin generates must load both where Node runs it
// unbundled, as the tests do, and where the command bundle inlines it. The
// vendored schema needs no Ajv runtime helper, so a schema that needs two
// stands in for a schema pin that would.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { describe, expect, onTestFinished, test } from 'vitest'
import { esmValidatorCode, mnxValidatorPlugin, validatorCode } from '../scripts/mnx-validator.js'
import { thirdPartyNoticesPlugin } from '../scripts/third-party-notices.js'
import type { SchemaError } from '../cli/mnx-validator.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// maxLength counts with ucs2length, and uniqueItems and an enum of objects
// compare with equal.
const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 3 },
    list: { type: 'array', uniqueItems: true },
    pick: { enum: [{ x: 1 }] },
  },
}

interface Validate {
  (document: unknown): boolean
  errors?: SchemaError[] | null
}

function workspace(parent: string): string {
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'mnx-validator-'))
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  writeFileSync(join(dir, 'schema.json'), JSON.stringify(SCHEMA))
  return dir
}

async function load(file: string): Promise<Validate> {
  const module = (await import(pathToFileURL(file).href)) as { validate: Validate }
  return module.validate
}

function expectHelpersWork(validate: Validate): void {
  expect(validate({ name: 'abc', list: [1, 2], pick: { x: 1 } })).toBe(true)
  expect(validate({ name: 'abcd', list: [1, 1], pick: { x: 2 } })).toBe(false)
  expect(validate.errors?.map((error) => error.instancePath)).toEqual(['/name', '/list', '/pick'])
}

describe('the generated validator', () => {
  test('runs unbundled in Node', async () => {
    // Under node_modules, so the generated imports resolve from the project.
    const dir = workspace(join(ROOT, 'node_modules', '.cache'))
    const code = validatorCode(join(dir, 'schema.json'))
    writeFileSync(join(dir, 'validator.js'), code)

    expect(code).not.toContain('require(')
    expectHelpersWork(await load(join(dir, 'validator.js')))
  })

  test('runs bundled with its helpers inlined, and names their licences', async () => {
    // Outside node_modules, where the notices would take the entry for a package.
    const dir = workspace(tmpdir())
    writeFileSync(join(dir, 'entry.js'), "export { validate } from 'virtual:mnx-validator'\n")
    await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        mnxValidatorPlugin(join(dir, 'schema.json')),
        thirdPartyNoticesPlugin('NOTICES.txt'),
      ],
      build: {
        lib: { entry: join(dir, 'entry.js'), formats: ['es'], fileName: () => 'bundle.js' },
        outDir: join(dir, 'out'),
        minify: false,
      },
    })

    const bundle = join(dir, 'out', 'bundle.js')
    // Nothing resolves ajv outside the project, so the bundle loads only
    // with the helpers inlined.
    expect(readFileSync(bundle, 'utf8')).not.toMatch(/^import /m)
    expectHelpersWork(await load(bundle))
    const notices = readFileSync(join(dir, 'out', 'NOTICES.txt'), 'utf8')
    expect(notices).toMatch(/^ajv \d/m)
    expect(notices).toMatch(/^fast-deep-equal \d/m)
  })

  test('refuses a module that is not an Ajv runtime helper', () => {
    expect(() => esmValidatorCode('const f = require("re2");')).toThrow(
      'loads a module that is not an Ajv runtime helper',
    )
  })

  test('imports each helper once', () => {
    const code = esmValidatorCode(
      'const a = require("ajv/dist/runtime/equal").default;' +
        'const b = require("ajv/dist/runtime/equal").default;',
    )

    expect(code.match(/import \* as/g)).toHaveLength(1)
  })
})
