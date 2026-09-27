import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, onTestFinished, test } from 'vitest'
import { thirdPartyNotices, thirdPartyNoticesPlugin } from '../scripts/third-party-notices.js'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'musicxml-to-mnx-notices-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const manifest = (name: string, version: string, license?: string): string =>
  JSON.stringify({ name, version, license })

describe('thirdPartyNotices', () => {
  test('lists each inlined package once, sorted, with its licence text', () => {
    const root = tree({
      'node_modules/zeta/package.json': manifest('zeta', '2.0.0', 'MIT'),
      'node_modules/zeta/LICENSE': 'zeta licence\n',
      'node_modules/zeta/dist/a.js': '',
      'node_modules/zeta/dist/b.js': '',
      'node_modules/@scope/alpha/package.json': manifest('@scope/alpha', '1.0.0', 'BSD-3-Clause'),
      'node_modules/@scope/alpha/license.md': 'alpha licence',
      'node_modules/@scope/alpha/dist/package.json': JSON.stringify({ version: '0.0.0' }),
      'node_modules/@scope/alpha/dist/esm/package.json': JSON.stringify({
        name: 'esm',
        type: 'module',
      }),
      'node_modules/@scope/alpha/dist/esm/index.js': '',
      'node_modules/beta/node_modules/zeta/package.json': manifest('zeta', '1.0.0', 'ISC'),
      'node_modules/beta/node_modules/zeta/LICENCE.txt': 'old zeta licence',
      'node_modules/beta/node_modules/zeta/index.js': '',
    })

    const notices = thirdPartyNotices(
      [
        join(root, 'src/index.ts'),
        join(root, 'node_modules/zeta/dist/a.js'),
        join(root, 'node_modules/@scope/alpha/dist/esm/index.js'),
        join(root, 'node_modules/beta/node_modules/zeta/index.js'),
        join(root, 'node_modules/zeta/dist/b.js'),
        '\0virtual-module',
      ],
      root,
    )

    expect(notices).toBe(
      [
        '@scope/alpha 1.0.0 (BSD-3-Clause)\n\nalpha licence\n',
        'zeta 1.0.0 (ISC)\n\nold zeta licence\n',
        'zeta 2.0.0 (MIT)\n\nzeta licence\n',
      ].join('\n---\n\n'),
    )
  })

  test('is empty when nothing comes from node_modules', () => {
    expect(thirdPartyNotices(['/project/src/index.ts'], '/project')).toBe('')
  })

  test('names a package with no licence field as UNKNOWN', () => {
    const root = tree({
      'node_modules/bare/package.json': manifest('bare', '1.0.0'),
      'node_modules/bare/COPYING': 'terms',
      'node_modules/bare/index.js': '',
    })

    expect(thirdPartyNotices([join(root, 'node_modules/bare/index.js')], root)).toBe(
      'bare 1.0.0 (UNKNOWN)\n\nterms\n',
    )
  })

  test('refuses a package with no licence file', () => {
    const root = tree({
      'node_modules/silent/package.json': manifest('silent', '1.0.0', 'MIT'),
      'node_modules/silent/sublicense.txt': 'not the licence',
      'node_modules/silent/index.js': '',
    })

    expect(() => thirdPartyNotices([join(root, 'node_modules/silent/index.js')], root)).toThrow(
      /silent@1\.0\.0 has no licence file/,
    )
  })

  test('refuses a module with no package root above it', () => {
    const root = tree({ 'node_modules/loose/index.js': '' })

    expect(() => thirdPartyNotices([join(root, 'node_modules/loose/index.js')], root)).toThrow(
      /no package.json with a name and version above/,
    )
  })

  test('reads the object and array forms of the licence field', () => {
    const root = tree({
      'node_modules/object/package.json': JSON.stringify({
        name: 'object',
        version: '1.0.0',
        license: { type: 'MIT', url: 'https://example.org' },
      }),
      'node_modules/object/LICENSE': 'object terms',
      'node_modules/object/index.js': '',
      'node_modules/array/package.json': JSON.stringify({
        name: 'array',
        version: '1.0.0',
        licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }],
      }),
      'node_modules/array/LICENSE': 'array terms',
      'node_modules/array/index.js': '',
    })

    expect(
      thirdPartyNotices(
        [join(root, 'node_modules/object/index.js'), join(root, 'node_modules/array/index.js')],
        root,
      ),
    ).toBe(
      [
        'array 1.0.0 (MIT OR Apache-2.0)\n\narray terms\n',
        'object 1.0.0 (MIT)\n\nobject terms\n',
      ].join('\n---\n\n'),
    )
  })

  test('names a licence object with no type as UNKNOWN', () => {
    const root = tree({
      'node_modules/linked/package.json': JSON.stringify({
        name: 'linked',
        version: '1.0.0',
        license: { url: 'https://example.org/terms' },
      }),
      'node_modules/linked/LICENSE': 'linked terms',
      'node_modules/linked/index.js': '',
    })

    expect(thirdPartyNotices([join(root, 'node_modules/linked/index.js')], root)).toBe(
      'linked 1.0.0 (UNKNOWN)\n\nlinked terms\n',
    )
  })

  test('ships every licence file of a package, in name order', () => {
    const root = tree({
      'node_modules/dual/package.json': manifest('dual', '1.0.0', '(MIT OR Apache-2.0)'),
      'node_modules/dual/LICENSE-APACHE': 'apache terms',
      'node_modules/dual/LICENSE-MIT': 'mit terms',
      'node_modules/dual/index.js': '',
    })

    expect(thirdPartyNotices([join(root, 'node_modules/dual/index.js')], root)).toBe(
      'dual 1.0.0 ((MIT OR Apache-2.0))\n\napache terms\n\nmit terms\n',
    )
  })

  test('counts only what sits in the node_modules of the project root', () => {
    const outer = tree({ 'node_modules/project/src/index.ts': '' })
    const root = join(outer, 'node_modules/project')

    expect(thirdPartyNotices([join(root, 'src/index.ts')], root)).toBe('')
  })
})

describe('thirdPartyNoticesPlugin', () => {
  type Bundle = Record<string, { type: 'chunk'; moduleIds: string[] } | { type: 'asset' }>

  function emitted(root: string, bundle: Bundle): unknown[] {
    const files: unknown[] = []
    const plugin = thirdPartyNoticesPlugin('NOTICES.txt')
    const configResolved = plugin.configResolved as (config: { root: string }) => void
    configResolved({ root })
    const hook = plugin.generateBundle as (
      this: { emitFile: (file: unknown) => void },
      options: unknown,
      bundle: Bundle,
    ) => void
    hook.call({ emitFile: (file) => files.push(file) }, {}, bundle)
    return files
  }

  test('emits the notices for the modules of every chunk', () => {
    const root = tree({
      'node_modules/zeta/package.json': manifest('zeta', '2.0.0', 'MIT'),
      'node_modules/zeta/LICENSE': 'zeta licence',
      'node_modules/zeta/index.js': '',
    })

    expect(
      emitted(root, {
        'cli.js': { type: 'chunk', moduleIds: [join(root, 'node_modules/zeta/index.js')] },
        'style.css': { type: 'asset' },
      }),
    ).toEqual([
      {
        type: 'asset',
        fileName: 'NOTICES.txt',
        source:
          "Third-party code bundled into this package's files, with its licence.\n\nzeta 2.0.0 (MIT)\n\nzeta licence\n",
      },
    ])
  })

  test('emits nothing when no chunk inlines a package', () => {
    expect(
      emitted('/project', { 'cli.js': { type: 'chunk', moduleIds: ['/project/src/index.ts'] } }),
    ).toEqual([])
  })
})
