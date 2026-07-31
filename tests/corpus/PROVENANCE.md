# Vendored corpus

Six hundred published songs, converted on every test run.

They are here because the bugs that mattered were all found by running against
real music rather than by the unit tests: a grace note taking time it does not
have, a chord member arriving after its tuplet closed, a note carrying two
`<notations>` blocks, spanner numbering scoped to the wrong thing. None of
those shapes appears in a hand-written fixture unless you already know to
write it.

A large sample rather than a handful because a small one kept being the
problem. Two readings of slur numbering resolved three songs identically and
disagreed only on a fourth, and the file that settled it was not among the
three. Each time the count has grown, real music the smaller sample never held
has surfaced fresh defects: growing to six hundred found a lyric written twice
on one note that the converter collapsed, and confirmed two spanner and beam
fixes on shapes the two hundred never contained.

## Source and licence

All six hundred come from the [OpenScore Lieder
corpus](https://github.com/OpenScore/Lieder), released under **Creative
Commons Zero**, so they can be redistributed here without condition.
Transcribed by OpenScore volunteers and moderated by a professional
proofreading team, from public-domain editions on IMSLP.

`SOURCES.json` records the composer, work, and upstream path of each file.

## Why `.mxl`

`.mxl` is the standard compressed MusicXML container, and it is what the
corpus publishes. The XML inside is around twenty times larger: six hundred
songs come to around ten megabytes this way, against two hundred uncompressed.
The
files are byte-for-byte as retrieved, so they are excluded from formatting,
and `tests/support/corpus.ts` reads the score out of each container.

## How they were chosen

Spread across the corpus rather than taken from the front of it, so the sample
is not all Schubert. The first fifty were one song from each of fifty
composers. The next hundred and fifty came by going round the composers of the
corpus in alphabetical order, taking one more song from each on each pass, in
the corpus's own order, until the count reached two hundred, so every composer
is represented and the busier ones a little more.

The four hundred that took it to six hundred continue the same round: for each
composer in turn, the next songs not already vendored, ordered by their upstream
path, one more per pass, until four hundred more convert. Eighty-six composers
gained songs this way, at most six from any one.

A song is skipped over where the converter refuses it: an empty metronome
tempo, or a tuplet the source never bracketed. Ten were skipped over reaching
six hundred, all in classes already recorded.

Four songs are pinned deliberately, because each has already caught a defect
the rest of the suite missed:

| File                                     | Work                          | What it caught                                                                                                                            |
| ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `brahms-wiegenlied`                      | Brahms, Op. 49 No. 4          | Grace notes taking time from the measure, which left two bars overfull.                                                                   |
| `schumann-ich-stand-in-dunklen-traeumen` | Clara Schumann, Op. 13 No. 1  | A slur crossing between voices.                                                                                                           |
| `schumann-im-wunderschoenen-monat-mai`   | Robert Schumann, Op. 48 No. 1 | Ties and slurs running between the pianist's two hands, which settled that spanner numbering is scoped to the part rather than the voice. |
| `schubert-der-lindenbaum`                | Schubert, D. 911 No. 5        | Chord members inside tuplets, and notes carrying two `<notations>` blocks.                                                                |

## What these files get wrong, and what is refused

MuseScore's MusicXML export renumbers slurs on the way out, and a few come out
crossed: a `stop` whose `start` was never written. Checked against the
MuseScore sources, where every slur carries an explicit id: all 21 in the
Clara Schumann pair up correctly, so the transcriptions are sound and the
export is not. A handful of ties and slurs therefore cannot be joined, and are
reported rather than guessed at. The warning baseline records how many.

Every one of the six hundred converts: the songs the converter refuses were
skipped when the corpus was chosen, and the corpus test pins that none is
refused, so one starting to be rejected is a change somebody chose.

Some write a measure longer than its time signature, such as five quarters in
a 3/4 bar. That is the source's own doing, and carrying it over faithfully is
correct, which is why the measure and direction checks are made against the
source rather than against the time signature.

Some write a note whose value disagrees with its duration, a dotted half
lasting two beats. The converter carries the written value and reports it as
`inconsistent:duration`. Its measures then sound as the written values do,
not as the durations add up, so the length and direction checks skip those
songs; the pitch and schema checks still hold them to account.
