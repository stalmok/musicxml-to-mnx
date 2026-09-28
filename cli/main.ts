// Wires the argument list and the console to run(), and sets the exit code.
// All logic stays in run() so that tests can call it.

import { run } from './run.js'

run(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    // An error that escapes run() is a bug, not a refused file.
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
