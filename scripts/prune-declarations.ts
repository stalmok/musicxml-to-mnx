// Keeps the declaration files the public entry reaches and removes the rest.
// tsc emits a declaration for every module in the program, internal stages
// included, and the package would otherwise ship them all.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist/types')
const entry = join(root, 'index.d.ts')

const SPECIFIER = /(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g

function declarationOf(importer: string, specifier: string): string {
  const path = resolve(dirname(importer), specifier.replace(/\.js$/, '.d.ts'))
  if (!existsSync(path)) {
    throw new Error(`${relative(root, importer)} imports ${specifier}, which has no declaration`)
  }
  return path
}

const kept = new Set<string>()
const pending = [entry]
for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
  if (kept.has(file)) continue
  kept.add(file)
  for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
    pending.push(declarationOf(file, specifier!))
  }
}

/** Removes every declaration not kept, and returns whether the directory is left empty. */
function prune(directory: string): boolean {
  let empty = true
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() ? prune(path) : !kept.has(path)) rmSync(path, { recursive: true })
    else empty = false
  }
  return empty
}

prune(root)
