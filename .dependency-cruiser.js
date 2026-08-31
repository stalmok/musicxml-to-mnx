// The import graph, checked. This is where the architecture's stage
// boundaries are stated: docs/architecture.md explains them in prose, and
// these rules are the copy a build can fail on. Crossing one is an
// architecture change, so amend that document first.
//
// Boundaries used to be `no-restricted-imports` in eslint.config.js. They are
// here instead, stated once, because these rules match resolved module paths
// rather than the text of an import, and because a graph tool sees what a
// per-file linter cannot: cycles, files nothing imports, and a dev-only
// dependency reaching the shipped library.

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    // === Stage boundaries ===
    //
    // MusicXML knowledge stops at the reader and MNX knowledge starts at the
    // writer. Both stages meet at the model, and neither knows the pipeline
    // that drives them.
    {
      name: 'reader-knows-no-mnx',
      comment:
        'The reader produces the neutral score model, so it must not know the MNX output shape, the pipeline, or the packaging layer.',
      severity: 'error',
      from: { path: '^src/read/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(write/|types/|convert\\.ts$|container\\.ts$)' },
    },
    {
      name: 'writer-knows-no-musicxml',
      comment:
        'The writer consumes the neutral score model, so it must not know MusicXML, the XML layer, the pipeline, or the packaging layer.',
      severity: 'error',
      from: { path: '^src/write/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(read/|xml/|convert\\.ts$|container\\.ts$)' },
    },
    {
      name: 'model-is-a-boundary',
      comment:
        'The model depends on neither stage, the MNX types, nor the XML layer; that is what keeps it a boundary.',
      severity: 'error',
      from: { path: '^src/model/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(read/|write/|types/|xml/|convert\\.ts$|container\\.ts$)' },
    },
    {
      name: 'leaves-do-not-reach-back',
      comment:
        'The XML layer knows no music and the MNX types know only the wire format. Neither may import a stage or the model.',
      severity: 'error',
      from: { path: '^src/(xml|types)/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(read/|write/|model/|convert\\.ts$|container\\.ts$)' },
    },
    {
      name: 'model-is-not-public-api',
      comment:
        'The model is internal: it decouples the two stages and is never exported, so the public API must not name it.',
      severity: 'error',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/model/' },
    },
    {
      name: 'cli-uses-public-api',
      comment:
        'The command is a consumer of the library, not a fourth stage: it goes through src/index.ts alone, like any other user of the package.',
      severity: 'error',
      from: { path: '^cli/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/', pathNot: '^src/index\\.ts$' },
    },
    {
      name: 'library-does-not-import-the-command',
      comment:
        'The command depends on the library, so the library must not depend back on it. cli/ is a Node program and is not in the published bundle.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^cli/' },
    },

    // === The isomorphic core ===
    //
    // tsconfig.json withholds Node's and the DOM's types from src, which
    // stops a global. An `import` of a core module is the other way in, and
    // this is what stops that one.
    {
      name: 'core-is-not-isomorphic',
      comment:
        'The library runs in a browser as well as in Node, so src must not import a Node core module. The command in cli/ is a Node program and may.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'library-ships-no-dev-dependency',
      comment:
        'A devDependency is absent from an install of the package, so the shipped library must not import one. ajv is dev-only and belongs to the test suite and the command, which bundles it.',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'shipped-code-holds-no-test',
      comment: 'Tests and their helpers are not shipped, so nothing shipped may import one.',
      severity: 'error',
      from: { path: '^(src|cli)/', pathNot: '\\.(test|bench)\\.ts$' },
      to: { path: '(\\.(test|bench)\\.ts$|^tests/)' },
    },

    // === Graph health ===
    {
      name: 'no-circular',
      comment:
        'A cycle makes module initialisation order load-bearing and makes the two-stage split unreadable. Extract the shared part instead.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'A file nothing imports is either dead or a missing wire-up. Entry points, tests, and configuration are exempt because nothing is meant to import them.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '\\.(test|bench)\\.ts$',
          '^cli/main\\.ts$', // the command's entry point
          '^src/index\\.ts$', // the package's entry point
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', // dot-configuration, this file included
          '(^|/)[^/]+\\.config\\.(js|cjs|mjs|ts)$',
        ],
      },
      to: {},
    },
    {
      name: 'unreachable-from-entry',
      comment:
        'Every shipped file has to be reachable from the package entry point or the command, or nothing that installs this package can run it. Catches the dead file that no-orphans cannot see, the one that still imports something.',
      severity: 'error',
      from: { path: '^(src/index\\.ts|cli/main\\.ts)$' },
      to: {
        path: '^(src|cli)/',
        pathNot: ['\\.(test|bench)\\.ts$', '^(src/index\\.ts|cli/main\\.ts)$'],
        reachable: false,
      },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'An import that does not resolve is a broken build waiting for the right entry.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-in-package-json',
      comment:
        'Every package imported has to be declared in package.json. A backstop under pnpm rather than a live gate: pnpm hoists no transitive dependency to the top of node_modules, so an undeclared package does not resolve at all and not-to-unresolvable reports it first.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-duplicate-dep-types',
      comment:
        'A package listed under two dependency types leaves it ambiguous whether an install of this package gets it.',
      severity: 'error',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-deprecated-core',
      comment: 'A deprecated core module is removed in some later Node.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: '^(punycode|domain|constants|sys|_.*|assert/strict)$',
      },
    },
  ],

  options: {
    // node_modules is a dependency, not a subject: record what is imported
    // from it without walking into it.
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage)/' },

    // Source imports carry a `.js` extension that resolves to a `.ts` file
    // (moduleResolution: Bundler with verbatimModuleSyntax), so the resolver
    // needs the compiler's own view to follow them.
    tsConfig: { fileName: 'tsconfig.test.json' },
    // Type-only imports are still imports for a boundary rule: `import type`
    // across a stage line is the same architecture change as a value import.
    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types'],
      mainFields: ['module', 'main', 'types'],
    },

    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      archi: { collapsePattern: '^(src/[^/]+|cli|tests)' },
    },
  },
}
