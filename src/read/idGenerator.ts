import { countedId } from '../ids.js'

/**
 * Deterministic ids, so that converting the same file twice gives
 * byte-for-byte the same output. They follow document order, except that a
 * rest filling the measure written as an event takes its id once the
 * measure is whole.
 */
export class IdGenerator {
  #events = 0
  #notes = 0
  #kitComponents = 0

  nextEvent(): string {
    this.#events += 1
    return countedId('event', this.#events)
  }

  nextNote(): string {
    this.#notes += 1
    return countedId('note', this.#notes)
  }

  nextKitComponent(): string {
    this.#kitComponents += 1
    return countedId('kitComponent', this.#kitComponents)
  }
}
