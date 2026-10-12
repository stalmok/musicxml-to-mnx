// What is read from a <note> once and shared by the modules that place it.

import type { Fraction } from '../fraction.js'
import type { NoteValue } from '../model/score.js'
import type { XmlElement } from '../xml/parse.js'
import type { ElementReader } from './element.js'
import type { EventNotation } from './eventNotations.js'
import type { VoiceLine } from './voices.js'

/** What a <note> states that says whether it rests its voice's measure. */
export interface RestNote {
  element: ElementReader
  notations: readonly ElementReader[]
  rest: XmlElement | undefined
  grace: XmlElement | undefined
  /** The value the note states in <type>, where it states one. */
  written: NoteValue | undefined
  duration: Fraction | undefined
  /** The line of its voice the note is written in. */
  voice: VoiceLine
}

/** What is read from a <note> once and shared by the paths that place it. */
export interface NoteStatement extends Omit<RestNote, 'voice'> {
  /** The voice the note names, where it names one. */
  namedVoice: string | undefined
  /** The notations the note writes on its event. */
  eventNotations: readonly EventNotation[]
  tieds: readonly XmlElement[]
  /** The <tuplet> markers in a block hidden with print-object="no". */
  hiddenTuplets: ReadonlySet<XmlElement>
  pitch: XmlElement | undefined
  unpitched: XmlElement | undefined
  staff: number | undefined
  staffPosition: number | undefined
  /** Whether the note is hidden with print-object="no". */
  hidden: boolean
  /**
   * Reports the note and its <notations> blocks hidden, each in the place it
   * was read. Given `only`, just a block holding a fermata is reported, naming
   * it: nothing else in the block is converted, so hiding it loses nothing.
   */
  reportHidden: (only?: 'fermata') => void
}

/** The same, once the note has the line of its voice it is written in. */
export type VoicedNote = NoteStatement & RestNote
