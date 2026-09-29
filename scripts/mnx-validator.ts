// Generates the MNX schema validator as `virtual:mnx-validator`, so the command
// and the tests run code Ajv compiled once, and the command ships without Ajv.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import standaloneCode from 'ajv/dist/standalone/index.js'
import type { Plugin } from 'vite'

const ID = 'virtual:mnx-validator'
const RESOLVED = `\0${ID}`
const SCHEMA = fileURLToPath(new URL('../schema/mnx-schema.json', import.meta.url))

const RUNTIME_REQUIRE = /require\("(ajv\/dist\/runtime\/\w+)"\)\.default/g

/**
 * Ajv's standalone code loads the helpers some keywords need with require(),
 * even in ESM mode. Each becomes an import, which the command bundle inlines.
 * Node gives a CommonJS module's exports object as its default, and Rollup
 * gives its `default` export, so the helper is taken from either.
 */
export function esmValidatorCode(code: string): string {
  const bindings = new Map<string, string>()
  const body = code.replace(RUNTIME_REQUIRE, (_, module: string) => {
    const binding = bindings.get(module) ?? `ajvRuntime${String(bindings.size)}`
    bindings.set(module, binding)
    return `(${binding}.default.default ?? ${binding}.default)`
  })
  // A string of the schema, written into the code, escapes its quotes.
  if (body.includes('require("')) {
    throw new Error('The generated validator loads a module that is not an Ajv runtime helper.')
  }
  const imports = [...bindings].map(
    ([module, binding]) => `import * as ${binding} from "${module}.js";`,
  )
  return imports.join('') + body
}

/** The validator module for the schema at this path. */
export function validatorCode(schema: string): string {
  // strict:false because Ajv's strictTypes rejects the upstream schema's
  // keyword placement (a "maximum" with no "type"). allErrors reports every
  // problem, not only the first.
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    code: { source: true, esm: true },
  })
  const compiled = ajv.compile(JSON.parse(readFileSync(schema, 'utf8')) as object)
  return esmValidatorCode(standaloneCode(ajv, compiled))
}

export function mnxValidatorPlugin(schema = SCHEMA): Plugin {
  return {
    name: 'mnx-validator',
    enforce: 'pre',
    resolveId(source) {
      return source === ID ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return undefined
      this.addWatchFile(schema)
      return validatorCode(schema)
    },
  }
}
