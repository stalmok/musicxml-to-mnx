// Collects the licence text of every package a bundle inlines, so the bundle
// ships the notices those licences require.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { Plugin } from 'vite'

const LICENCE_FILE = /^(licen[cs]e|copying)(\.|$)/i

interface Package {
  name: string
  version: string
  license: string
  text: string
}

function packageOf(moduleId: string): Package | undefined {
  if (!moduleId.includes(`${sep}node_modules${sep}`)) return undefined
  for (let dir = dirname(moduleId); dir.includes(`${sep}node_modules${sep}`); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const { name, version, license } = JSON.parse(readFileSync(manifest, 'utf8')) as Partial<
      Record<'name' | 'version' | 'license', string>
    >
    // A nested package.json that only sets the module type is not the package root.
    if (name === undefined || version === undefined) continue
    const file = readdirSync(dir).find((entry) => LICENCE_FILE.test(entry))
    if (file === undefined) throw new Error(`${name}@${version} has no licence file in ${dir}`)
    return {
      name,
      version,
      license: license ?? 'UNKNOWN',
      text: readFileSync(join(dir, file), 'utf8').trim(),
    }
  }
  throw new Error(`no package.json with a name and version above ${moduleId}`)
}

export function thirdPartyNotices(moduleIds: Iterable<string>): string {
  const packages = new Map<string, Package>()
  for (const id of moduleIds) {
    const found = packageOf(id)
    if (found !== undefined) packages.set(`${found.name}@${found.version}`, found)
  }
  return [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map(({ name, version, license, text }) => `${name} ${version} (${license})\n\n${text}\n`)
    .join('\n---\n\n')
}

export function thirdPartyNoticesPlugin(fileName: string): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? output.moduleIds : [],
      )
      const notices = thirdPartyNotices(ids)
      if (notices === '') return
      this.emitFile({
        type: 'asset',
        fileName,
        source: `Third-party code bundled into this package's files, with its licence.\n\n${notices}`,
      })
    },
  }
}
