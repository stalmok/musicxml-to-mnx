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

export function mnxValidatorPlugin(): Plugin {
  return {
    name: 'mnx-validator',
    enforce: 'pre',
    resolveId(source) {
      return source === ID ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return undefined
      this.addWatchFile(SCHEMA)
      // strict:false because Ajv's strictTypes rejects the upstream schema's
      // keyword placement (a "maximum" with no "type"). allErrors reports every
      // problem, not only the first.
      const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        code: { source: true, esm: true },
      })
      return standaloneCode(ajv, ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')) as object))
    },
  }
}
