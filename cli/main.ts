// The command's entry point: wire the argument list and the console to run(),
// and turn its exit code into the process's. Kept to this so that run() itself
// stays a plain, testable function.

import { run } from './run.js'

run(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    // An error escaping run() is a bug, not a refused file; surface it whole.
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
