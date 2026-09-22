# Vendored corpus

Six hundred published songs and seven feature files, converted on every test
run. Every check in `tests/corpus.test.ts` runs over both.

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

The six hundred songs come from the [OpenScore Lieder
corpus](https://github.com/OpenScore/Lieder), released under **Creative
Commons Zero**, so they can be redistributed here without condition.
Transcribed by OpenScore volunteers and moderated by a professional
proofreading team, from public-domain editions on IMSLP.

`SOURCES.json` records the composer, work, and upstream path of each song.

The seven files in `features/` come from the [Unofficial MusicXML Test
Suite](https://github.com/cuthbertLab/musicxmlTestSuite), released under the
**MIT Licence**, which is reproduced in `features/LICENSE` as that licence
requires. Originally by Reinhold Kainhofer for the GNU LilyPond project,
developed since by Michael Scott Asato Cuthbert. They keep their upstream file
names, so that what each one is can be checked against the suite.

The two licences differ, so the two sets are kept apart on disk. Nothing here
may be added from a source without a redistribution grant: the MakeMusic
sample set is copyrighted piece by piece, and the music21 corpus states that
its encodings carry whatever terms their encoders set.

## Why the feature files are here

The six hundred are real music, and that is the point of them: every defect
that mattered was found in a combination no hand-written fixture would hold.
What real music cannot do is contain notation nobody wrote. Lieder is voice
and piano throughout, so no song in the upstream corpus of 1,462 contains a
single up-bow, down-bow, spiccato, stress, unstress, lyric elision, unpitched
note or `<transpose>`, and none states how much time a grace note takes. The
converter handles all of them, and the six hundred could not tell if any of it
broke.

The suite is not real music, and it is not a substitute for the six hundred.
It is the smallest set of files that exercises what real music of one kind
never will. One file per feature, so a failure names what broke:

| File                                   | What it holds that the songs do not                                  |
| -------------------------------------- | -------------------------------------------------------------------- |
| `23f-Tuplets-DurationButNoBracket.xml` | Tuplets stated as a ratio with no bracket drawn                      |
| `24d-AfterGrace.xml`                   | `steal-time-previous` and `steal-time-following`, and an after-grace |
| `32a-Notations.xml`                    | Spiccato, stress and unstress                                        |
| `32ab-Notations3.xml`                  | Up-bow, down-bow, and most of `<technical>`                          |
| `61j-Lyrics-Elisions.xml`              | Lyric elisions                                                       |
| `72b-TransposingInstruments-Full.xml`  | Nine transposing parts of eleven, one octave-displaced               |
| `73a-Percussion.xml`                   | Unpitched notes on percussion staves                                 |

`32ab-Notations3.xml` earns its place twice over: besides the two bow marks it
writes eighteen of the twenty-nine `<technical>` children that MNX has nowhere
to put, so those no-home registry entries are exercised rather than only
asserted against the schema.

The vendored corpus does not cover measure repeats, `make-time` on grace
notes, or hairpins ending at `niente`.

Earlier searches found one measure repeat in the music21 corpus, but that
file is not included here. Those searches found no examples of the other two
features in Lieder, the test suite, MakeMusic, music21, or the CPDL and PDMX samples.

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

The feature files are kept as the `.xml` their suite publishes, uncompressed:
they come to sixty kilobytes together, and a diff that shows the up-bow is
worth more than the saving.

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
