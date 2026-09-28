// Collects the licence text of every package a bundle inlines.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

const LICENCE_FILE = /^(licen[cs]e|copying)([.-]|$)/i

interface Manifest {
  name?: string
  version?: string
  license?: string | { type?: string }
  licenses?: { type?: string }[]
}

interface Package {
  name: string
  version: string
  license: string
  text: string
}

// The licenses array and the object form are both deprecated, and both still ship.
function licenseOf({ license, licenses }: Manifest): string {
  const types = [license ?? licenses ?? []]
    .flat()
    .map((entry) => (typeof entry === 'string' ? entry : entry.type))
    .filter((type) => type !== undefined)
  return types.length === 0 ? 'UNKNOWN' : types.join(' OR ')
}

function packageOf(moduleId: string, root: string): Package | undefined {
  if (relative(root, moduleId).split(sep)[0] !== 'node_modules') return undefined
  for (let dir = dirname(moduleId); dir !== root; dir = dirname(dir)) {
    const path = join(dir, 'package.json')
    if (!existsSync(path)) continue
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
    const { name, version } = manifest
    // A nested package.json that only sets the module type is not the package root.
    if (name === undefined || version === undefined) continue
    const files = readdirSync(dir)
      .filter((entry) => LICENCE_FILE.test(entry))
      .sort()
    if (files.length === 0) throw new Error(`${name}@${version} has no licence file in ${dir}`)
    const text = files.map((file) => readFileSync(join(dir, file), 'utf8').trim()).join('\n\n')
    return { name, version, license: licenseOf(manifest), text }
  }
  throw new Error(`no package.json with a name and version above ${moduleId}`)
}

export function thirdPartyNotices(moduleIds: Iterable<string>, root: string): string {
  const packages = new Map<string, Package>()
  for (const id of moduleIds) {
    const found = packageOf(id, root)
    if (found !== undefined) packages.set(`${found.name}@${found.version}`, found)
  }
  return [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map(({ name, version, license, text }) => `${name} ${version} (${license})\n\n${text}\n`)
    .join('\n---\n\n')
}

export function thirdPartyNoticesPlugin(fileName: string): Plugin {
  let root = process.cwd()
  return {
    name: 'third-party-notices',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? output.moduleIds : [],
      )
      const notices = thirdPartyNotices(ids, root)
      if (notices === '') return
      this.emitFile({
        type: 'asset',
        fileName,
        source: `Third-party code bundled into this package's files, with its licence.\n\n${notices}`,
      })
    },
  }
}
