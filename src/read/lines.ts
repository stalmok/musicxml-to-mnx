// Telling the lines of a voice apart across the barline.
//
// A voice the source writes in two lines laid over each other is read into
// one sequence per line, measure by measure. Nothing in MusicXML says which
// line of one measure carries on which line of the measure before, and MNX
// reads one voice name as one line across the score. So each line is matched
// here, once per measure, to a line the part has already written, and keeps
// that line's name. Beams, sequence names and ties all follow this match.

/** One line of a voice as a measure writes it. */
export interface WrittenLine {
  /** The staff most of its notes are on. */
  staff: number | undefined
  /** The notes of the first event it sounds that takes time, and of the grace notes before it. */
  opening: readonly string[]
  /** The notes of the last event it sounds, or nothing where it sounds none. */
  closing: readonly string[] | undefined
  /** The staff of the event that opens the measure with a primary continue or end, where one does. */
  carriesBeam: { staff: number | undefined } | undefined
  /** The staff its primary beam is left open on at the closing barline, where it is. */
  leavesBeamOpen: { staff: number | undefined } | undefined
}

/** A line of a measure, as the part knows it. */
export interface PlacedLine {
  /** Tells the line apart from every other line of the part. */
  key: string
  /** The voice MNX names it by. Unset on the first line of a voice the source names none. */
  name: string | undefined
  /**
   * Where the line opens with a primary continue or end: the line whose open
   * beam it carries on, or nothing where it starts a beam of its own. Unset
   * where its voice left no beam open for it.
   */
  beamFrom: { line: string | undefined } | undefined
}

/** What the ties written on a note pair by, at each end it holds. */
export interface TiesOn {
  start: string | undefined
  stop: string | undefined
}

interface KnownLine {
  readonly key: string
  readonly name: string | undefined
  /** The order the line was first written in among the lines of its voice. */
  readonly order: number
  /** Its rank among the lines of its voice in the last measure that wrote it. */
  rank: number
  /** The last measure that wrote it, counted from the part's first. */
  writtenIn: number
  staff: number | undefined
  /** What a tie started on the last event it sounded pairs by. */
  tied: ReadonlySet<string>
  /**
   * The staves the voice has sounded on in other lines since a measure last
   * wrote this one. Such a measure may be sounding this line in another.
   */
  unsure: Set<number | undefined>
  /** The staff its primary beam was left open on at the last barline, where it was. */
  beamOpen: { staff: number | undefined } | undefined
}

/**
 * The lines of every voice of a part, matched measure by measure.
 *
 * A measure that writes a voice in one line writes it in the voice's first
 * line, which is named after the voice: the one line holds every line of the
 * voice, so nothing says it carries on one more than another.
 *
 * Where a measure writes two or more, a line carries on the line before it
 * that a beam or a tie says it does: a primary beam it carries on over the
 * barline, or a tie into its first note from the last note another line
 * sounded. Each is taken where it names the line of the same rank, or the one
 * line no other has taken. The lines left take the lines left in order of
 * rank, as the higher line comes first in closed score. Any line still left
 * is a new one.
 */
export class PartLines {
  readonly #voices = new Map<string | undefined, KnownLine[]>()
  /** Every voice name the part states or builds, which a built name steps past. */
  readonly #taken: Set<string>
  readonly #tiesOn: (note: string) => TiesOn
  /** The measure being matched, counted from the part's first. */
  #measure = -1

  constructor(partVoices: ReadonlySet<string>, tiesOn: (note: string) => TiesOn) {
    this.#taken = new Set(partVoices)
    this.#tiesOn = tiesOn
  }

  /**
   * Matches the lines of one measure, voice by voice, each voice's lines
   * highest first, and hands back the line each one is.
   */
  measure(
    voices: ReadonlyMap<string | undefined, readonly WrittenLine[]>,
  ): ReadonlyMap<string | undefined, readonly PlacedLine[]> {
    this.#measure += 1
    const openBefore = new Map<KnownLine, { staff: number | undefined }>()
    for (const line of [...this.#voices.values()].flat()) {
      if (line.beamOpen) openBefore.set(line, line.beamOpen)
      line.beamOpen = undefined
    }
    return new Map(
      [...voices].map(([voice, lines]) => [voice, this.#place(voice, lines, openBefore)]),
    )
  }

  #place(
    voice: string | undefined,
    lines: readonly WrittenLine[],
    openBefore: ReadonlyMap<KnownLine, { staff: number | undefined }>,
  ): PlacedLine[] {
    const known = this.#voices.get(voice) ?? []
    this.#voices.set(voice, known)

    // A voice that names nothing is told apart by its staff alone, so its
    // beam carries on only on the staff it left.
    const leftOpen = (line: WrittenLine): KnownLine[] =>
      line.carriesBeam === undefined
        ? []
        : known.filter((before) => {
            const open = openBefore.get(before)
            return (
              open !== undefined && (voice !== undefined || open.staff === line.carriesBeam?.staff)
            )
          })

    const placed =
      lines.length === 1
        ? [known[0] ?? this.#newLine(voice, known)]
        : this.#match(voice, known, lines, leftOpen)

    const beamFrom = this.#carryBeams(lines, placed, leftOpen)
    this.#written(known, lines, placed)
    return placed.map((line, rank) => ({
      key: line.key,
      name: line.name,
      beamFrom: beamFrom[rank],
    }))
  }

  #match(
    voice: string | undefined,
    known: KnownLine[],
    lines: readonly WrittenLine[],
    leftOpen: (line: WrittenLine) => KnownLine[],
  ): KnownLine[] {
    // Of two lines that held one rank, the one written later holds it now. A
    // stable sort keeps lines of one rank and one measure in the order they
    // were first written.
    const byRank = [...known].sort((a, b) => a.rank - b.rank || b.writtenIn - a.writtenIn)
    const claims: (KnownLine | undefined)[] = lines.map(() => undefined)
    const claim = (candidates: (line: WrittenLine) => KnownLine[]): void => {
      const free = (line: WrittenLine) => candidates(line).filter((c) => !claims.includes(c))
      for (const [rank, line] of lines.entries()) {
        const ofRank = byRank[rank]
        if (!claims[rank] && ofRank && free(line).includes(ofRank)) claims[rank] = ofRank
      }
      for (const [rank, line] of lines.entries()) {
        if (claims[rank]) continue
        const [only, ...others] = free(line)
        if (only && others.length === 0) claims[rank] = only
      }
    }
    claim(leftOpen)
    claim((line) => this.#tiedFrom(known, line))

    const left = byRank.filter((line) => !claims.includes(line))
    return claims.map((claimed) => claimed ?? left.shift() ?? this.#newLine(voice, known))
  }

  /**
   * The lines a tie into the line's first note can come from: those whose
   * last note starts a tie of its pitch, where no measure since may have
   * sounded them in another line.
   */
  #tiedFrom(known: readonly KnownLine[], line: WrittenLine): KnownLine[] {
    const stops = new Set(line.opening.flatMap((note) => this.#tiesOn(note).stop ?? []))
    return known.filter(
      (before) =>
        [...before.tied].some((pairing) => stops.has(pairing)) &&
        !before.unsure.has(undefined) &&
        !before.unsure.has(before.staff) &&
        !before.unsure.has(line.staff),
    )
  }

  /**
   * The open beam each line carries on: its own line's, or else the one
   * beam its voice left open that no other line carries on. Where none or
   * several are left, it starts a beam of its own.
   */
  #carryBeams(
    lines: readonly WrittenLine[],
    placed: readonly KnownLine[],
    leftOpen: (line: WrittenLine) => KnownLine[],
  ): ({ line: string | undefined } | undefined)[] {
    const from: ({ line: string | undefined } | undefined)[] = lines.map(() => undefined)
    const carried = new Set<KnownLine>()
    for (const [rank, line] of lines.entries()) {
      const own = placed[rank] as KnownLine
      if (leftOpen(line).includes(own)) {
        carried.add(own)
        from[rank] = { line: own.key }
      }
    }
    for (const [rank, line] of lines.entries()) {
      const open = leftOpen(line)
      if (from[rank] || open.length === 0) continue
      const [only, ...others] = open.filter((before) => !carried.has(before))
      if (only && others.length === 0) {
        carried.add(only)
        from[rank] = { line: only.key }
      } else {
        from[rank] = { line: undefined }
      }
    }
    return from
  }

  /** Records what the measure wrote of each line of the voice. */
  #written(
    known: readonly KnownLine[],
    lines: readonly WrittenLine[],
    placed: readonly KnownLine[],
  ): void {
    for (const [rank, line] of lines.entries()) {
      const into = placed[rank] as KnownLine
      into.rank = rank
      into.writtenIn = this.#measure
      into.staff = line.staff
      into.unsure.clear()
      into.beamOpen = line.leavesBeamOpen
      if (line.closing) {
        into.tied = new Set(line.closing.flatMap((note) => this.#tiesOn(note).start ?? []))
      }
    }
    const sounding = lines.filter((line) => line.closing !== undefined)
    for (const before of known) {
      if (placed.includes(before)) continue
      for (const line of sounding) before.unsure.add(line.staff)
    }
  }

  /**
   * A line the voice has not written before. The first is named after the
   * voice. Another takes a name built from the voice and its place among the
   * voice's lines, stepped on past every name the part uses, since MNX lets
   * no two lines share one.
   */
  #newLine(voice: string | undefined, known: KnownLine[]): KnownLine {
    const order = known.length
    let name = voice
    if (order > 0) {
      let index = order + 1
      while (this.#taken.has(`${voice ?? ''}.${String(index)}`)) index += 1
      name = `${voice ?? ''}.${String(index)}`
      this.#taken.add(name)
    }
    const line: KnownLine = {
      key: JSON.stringify([voice, order]),
      name,
      order,
      rank: order,
      writtenIn: this.#measure,
      staff: undefined,
      tied: new Set(),
      unsure: new Set(),
      beamOpen: undefined,
    }
    known.push(line)
    return line
  }
}
