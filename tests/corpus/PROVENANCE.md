# Vendored corpus

Real published songs, converted on every test run. They are here because the
bugs that mattered were all found by running against real music rather than by
the unit tests: a grace note taking time it does not have, a chord member
arriving after its tuplet closed, a note carrying two `<notations>` blocks.
None of those shapes appears in a hand-written fixture unless you already know
to write it.

## Source and licence

All three come from the [OpenScore Lieder
corpus](https://github.com/OpenScore/Lieder), released under **Creative
Commons Zero**, so they can be redistributed here without condition.
Transcribed by OpenScore volunteers and moderated by a professional
proofreading team, from public-domain editions on IMSLP. Retrieved
2026-07-16, exported from MuseScore as MusicXML 4.0.

| File                                | Work                                                       | Why this one                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `brahms-wiegenlied.musicxml`        | Brahms, Wiegenlied, Op. 49 No. 4                           | Small, and holds grace notes and chords. Its two overfull bars are what exposed grace notes taking time from the measure.         |
| `clara-schumann-ich-stand.musicxml` | Clara Schumann, Ich stand in dunklen Träumen, Op. 13 No. 1 | Multi-voice, with a couple of tuplets.                                                                                            |
| `schubert-der-lindenbaum.musicxml`  | Schubert, Der Lindenbaum, Winterreise D. 911 No. 5         | 209 tuplets, chord members inside them, and notes carrying two `<notations>` blocks. Every tuplet bug so far came from this file. |

Roughly 1.3 MB of XML in total. That is a lot for a fixture, and worth it:
each of these has already caught a defect the rest of the suite missed.

The files are kept byte-for-byte as retrieved, so they are excluded from
formatting.
