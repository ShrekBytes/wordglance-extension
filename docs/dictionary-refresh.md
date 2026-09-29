# The bundled English dictionary

`data/wordglance-en-dictionary.json.gz` is the dictionary the extension will ship.
It is generated once from a pinned upstream extraction and committed. It is not
built by CI and not built at release time.

It is not read by the extension yet — see [Not yet read by the
extension](#not-yet-read-by-the-extension) below.

## Why it exists

ADR-0002 records the reason: the dictionary provider the extension used was a
single anonymous maintainer whose service failed pathologically, and a
credential-free dictionary is not available anywhere else that can be packaged.
The bundle makes four of the five Fields immune to a provider disappearing at
all. A headword the bundle does not carry falls through to a live provider;
that is the design, not a defect.

## The decisions this implements

All of these are fixed in ADR-0002 and in issue #15. They are not open. A change
to any of them is a change to a recorded decision: make it deliberately, in a
commit that says so.

| Decision | Value | Where |
| --- | --- | --- |
| Word list | FrequencyWords `en_50k.txt`, pinned at a commit | `SOURCES.frequencyWords` |
| Candidates | `[a-z]+` tokens only — 46,717 of them | `isCandidate` |
| Cut-off | the top 20,000 by corpus frequency | `BUDGET.candidates` |
| Definition | the first of a Sense, truncated to 220 characters | `BUDGET.definitionChars` |
| Example | one per Sense, truncated to 440 characters | `BUDGET.examples`, `BUDGET.exampleChars` |
| Synonym | four per Sense, single words only | `BUDGET.synonyms` |
| Antonym | four per Sense, single words only | `BUDGET.antonyms` |
| Senses | eight per headword, across every part of speech it is listed under | `BUDGET.senses` |
| Storage | gzipped, decompressed on load | `gzip` |

Three pruning rules are applied that ADR-0002 does not describe. They are
recorded here as deviations, and the first is a genuine judgement call rather
than a correction of the data:

| Rule | Why it is here |
| --- | --- |
| Inflected forms resolve to the headword they inflect | **A decision, not a correction.** 3,017 headwords — 15% of the cut-off — would otherwise resolve to "simple past of walk" and nothing else. The ADR does not mention inflected forms, so this is a judgement about what a Lookup should show, made here and recorded here. It is the deviation most worth revisiting, because it makes 3,017 headwords carry a *different* word's Senses. |
| Two Senses with the same part of speech and Definition are one Sense | Enforces CONTEXT.md: a Sense is a distinct meaning, and two identical ones are not distinct. Removes 172 duplicate Senses of 112,257, the worst case being five copies for one headword. Small in aggregate, and worth keeping because those are Definitions a reader would see twice. |
| Entry-level Synonym and Antonym lists are never used | ADR-0002 already decides this. Repeated because it is the rule most likely to be "fixed" by someone who has not read why. |

The cut-off is measured on token coverage rather than headword count, because
headword count is the wrong question. The measure that matters is how much
running English the bundle can answer with no network. The top 20,000 account
for **98.6%** of the word tokens in the corpus, against 99.4% at 30,000 and 93.6%
at 5,000. Widening to the full 46,717 list costs 10–13 MB for 0.14% more
coverage.

### Inflected forms resolve to the headword they inflect

Wiktionary files an inflected form under its own page, as a bare form-of note:
`walked` has "simple past and past participle of walk" and nothing else, `did`
has "simple past of do" and "past participle of do; done". Taken in extraction
order — which puts the form-of line *before* the headword's own entry — a reader
selecting `walked` or `did` would have been told what those words are forms of
rather than what they mean.

3,017 of the 20,000 resolve to nothing but a form-of note, and 5,168 lead with
one. That is a large share, because the frequency list is full of inflected
forms: `did`, `told`, `kids`, `sighs`, `started` and `footsteps` are all in its
top 20,000.

The generator therefore resolves them. A headword whose every Sense is a form-of
note takes the Senses of the headword it inflects, so `did` resolves to `do` and
`footsteps` to `footstep`. Where a headword has Senses of its own, the form-of
note is kept but sorted after them, because it is true and occasionally what a
reader wants, but it is not the answer to the question they asked. 2,999 of the
3,017 resolve; the other 18 name a phrase rather than a headword, and a headword
named neither cannot be resolved, so it is dropped.

A form-of note naming a *phrase* rather than a headword — "Initialism of
closed-circuit television" — resolves to nothing, and such a headword is dropped.
So is one whose target is not itself in the cut-off, and one that would redirect
to itself.

### Coverage, and the deviation from ADR-0002

ADR-0002 estimated "roughly nine in ten" of the 20,000 would have a Wiktionary
record, with coverage falling from 92% in the most frequent decile to 48% in the
least. The measured figure is higher and the shape is much flatter:

| Decile | Corpus frequency | Coverage |
| --- | --- | --- |
| 1 | 28,787,591–22,889 | 99.5% |
| 5 | 3,433–2,430 | 99.0% |
| 10 | 937–782 | 94.4% |

**This is a deviation from figures recorded in ADR-0002, recorded here as the
ticket requires.** The decisions are unchanged: the cut-off is still the top
20,000 of the same candidate list, and the per-headword budget is untouched. What
moved is the measured coverage, and the estimate was pessimistic on both counts.

The 445 misses are the frequency list's contraction fragments — `didn`, `doesn`,
`isn`, `wasn`, `couldn`, `somethin`, `runnin`, `lookin` — plus a handful of
initialisms and proper nouns. That list tokenises on whitespace, so every
apostrophe splits a contraction in two, and `didn` is not a word any dictionary
has an entry for. There is no entry to miss.

Two consequences worth stating rather than glossing over:

- Coverage of *records* is not coverage of *quality*. 99% says the headword has
  an entry. It does not say the entry is worth reading: a substantial share of
  the lower-frequency deciles resolve to "A surname." or "A number of places in
  the United States:". That is what the live-provider fallback in ADR-0002 is
  for.
- The per-decile fall is much weaker than ADR-0002 predicted — 94.4% at the
  bottom rather than 48% — so the case for the fallback is not that common words
  are missing. It is that the entries which are present are often thin.

The current artefact records its own `meta.coverage`, so a refresh can be
compared against its predecessor without unpacking anything.

### Size, and the deviation from ADR-0002

ADR-0002 measured 215 bytes per headword gzipped, giving 4.3 MB for 20,000. The
built artefact is **5.0 MB**, about 16% over. It is within the AMO limit by a
factor of forty and within the range the test accepts, but it is a deviation
from a figure ADR-0002 records, so it is documented here as the ticket requires.

Nothing in the budget was widened to get there, and the cut-off is unchanged at
20,000. The size comes from the Example budget, which ADR-0002 specifies as a
count (one per Sense) but not a length. Measured on the built artefact, Examples
account for 2.6 MB of the 5.0 MB — more than every Definition and relation
together — at 114 characters each on average. A quotation from a
nineteenth-century text is a long string, and the 440-character cap
(`BUDGET.exampleChars`, not a recorded decision, chosen here) is what stops the
longest ones dominating.

| Examples | Compressed size |
| --- | --- |
| capped at 440 characters (shipped) | 5.0 MB |
| capped at 120 characters | 4.2 MB |
| dropped entirely | 2.2 MB |

Cutting Examples to 120 characters would land inside ADR-0002's 4.3 MB. It was
not done, because 120 characters is roughly one clause, and an Example exists to
show the headword in a sentence a reader can read. Dropping Examples entirely
would fit the budget and cost the Field, which the domain model treats as a
first-class result rather than a nicety. The 0.5 MB is worth more than the
sentence fragments, against a limit with forty times the headroom.

If a future refresh needs the 4.3 MB figure rather than the readable Example,
that is a decision to reopen, and it belongs in an ADR rather than in a budget
constant.

## Regenerating

```
node tools/build-dictionary.js --build-date YYYY-MM-DD --expect-etag <etag>
```

`--build-date` defaults to today. Pass it explicitly when regenerating, so the
value in the artefact means the day you ran the build rather than the day you
remember running it.

`--expect-etag` is the guard on the unpinned source. kaikki.org republishes the
extraction in place with no versioned URL, so the ETag is the only pin available.
Passing the current artefact's ETag makes the build fail if the file has moved,
which turns a refresh into a deliberate act instead of a silent one. When it
does move, re-pin `SOURCES.wiktionary.etag` and say so in the commit: a new
upstream file is a new set of source data, not a mechanical rerun.

The run streams 3.3 GB and takes roughly 45 minutes. It resumes from the last
complete line if the connection drops, so a rerun after a failure continues
rather than starting over. It needs about 2 GB of memory.

### Iterating on the pruning rules

Changing a pruning rule does not need a 45-minute download to try out:

```
curl -H 'accept-encoding: identity' -o /tmp/extraction.jsonl \
  https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl

node tools/build-dictionary.js --build-date 2026-09-29 \
  --candidate-source /tmp/en_50k.txt --extraction-source /tmp/extraction.jsonl \
  --out /tmp/candidate.json.gz
```

A build from a local source is not a candidate for committing, and the artefact
says so itself: it records a null ETag, because no ETag was checked. An artefact
that claims a pin it did not verify is worse than one that admits it has none.

### Reproducibility

The artefact is a pure function of the two pinned sources and the build date, so
rerunning with the same three produces a byte-identical file. Three things make
that true, and all three are load-bearing:

- entry keys are sorted, so the output does not depend on the order the upstream
  extraction happens to emit words in;
- gzip is written at a fixed level with a zeroed mtime;
- the build date is an argument, not a call to the clock.

Verify it with two runs from a local extraction and a comparison, which costs a
build rather than a download:

```
node tools/build-dictionary.js --build-date 2026-09-29 \
  --candidate-source /tmp/en_50k.txt --extraction-source /tmp/extraction.jsonl \
  --out /tmp/a.gz
node tools/build-dictionary.js --build-date 2026-09-29 \
  --candidate-source /tmp/en_50k.txt --extraction-source /tmp/extraction.jsonl \
  --out /tmp/b.gz
cmp /tmp/a.gz /tmp/b.gz
```

This was verified for the committed artefact: two builds from the same pinned
extraction produced byte-identical files. The test suite covers the parts that
can be checked cheaply — the same input gzips to the same bytes, and the
serialisation is order-independent.

## What is in the artefact

```json
{
  "meta": {
    "buildDate": "2026-09-29",
    "headwordCount": 19555,
    "candidateCount": 20000,
    "coverage": 0.978,
    "tokenCoverage": 0.9861,
    "budget": { "...": "the per-headword budget, recorded so a refresh is comparable" },
    "sources": { "...": "both pins, as fetched" }
  },
  "entries": {
    "abandon": [
      {
        "pos": "verb",
        "definitions": [
          "To give up or relinquish control of, to surrender or to give oneself over, or to yield to one's emotions."
        ],
        "examples": ["[…] he abandoned himself […] to his favourite vice."],
        "synonyms": [],
        "antonyms": []
      }
    ],
    "did": [
      {
        "pos": "verb",
        "definitions": ["A syntactic marker."],
        "examples": ["Do you go there often?"],
        "...": "resolved from `do`, which is what `did` inflects"
      }
    ]
  }
}
```

A Sense holds exactly one Definition in the artefact, its first upstream gloss,
even though CONTEXT.md allows a Sense to carry several. ADR-0002's budget ("first
gloss truncated to 220 characters") is a per-Sense figure, and widening it to
several was not tested, so the lossy shape is recorded here rather than silently
inherited. Issue #16 reads this shape; if the Tooltip wants more than one
Definition per Sense, the budget and this artefact both change.

Each Sense carries its own Examples, Synonyms and Antonyms. The entry-level lists
in the upstream data are never used: they are unsorted dumps that span every
Sense, so a Synonym shown beside a Definition is often a word that belongs to a
different Sense entirely. Multi-word phrases are filtered out of Synonym and
Antonym lists at the source rather than trimmed, because "happy as a lark" is not
a word and truncating it to "happy" would assert a synonym the source did not.

Two Senses with the same part of speech and the same Definition are one Sense.
Wiktionary sometimes numbers a single Sense several times with the same
Definition and different examples, and the first build carried "A number of
places in the United States:" three times for one headword, which reads as a
fault in the extension rather than a quirk of the data. The same Definition under
two parts of speech stays two Senses, because that is what tells them apart. The
eight-Sense cap is a budget for the headword, not for each part of speech it is
listed under.

Where an entry has both its own Senses and form-of notes, the Senses come first
and the form-of notes after them, and a headword that is only a form-of note is
resolved to the headword it inflects. See
[Inflected forms resolve to the headword they inflect](#inflected-forms-resolve-to-the-headword-they-inflect).

## Licence and attribution

The definitions, examples and relations come from Wiktionary via the
[kaikki.org](https://kaikki.org/dictionary/English/) extraction, which is
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). That is a
share-alike licence with a real attribution obligation, not a formality: the
credit has to be visible to the reader, in the settings popup and in the store
listing, and it is not done by this file existing. The extraction tooling is
[wiktextract](https://github.com/tatuylonen/wiktextract); the commit that produced
the pinned file is recorded in the artefact's `meta.sources`.

The word-frequency list is from
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords), which
publishes the list without a licence. It is used here to choose which words to
carry, never as content, so nothing derived from it is redistributed.

## Not yet read by the extension

The artefact is committed but nothing loads it yet. Wiring it into `background.js`
is issue #16, and the packaging change that ships `data/` in the XPI belongs there
too — until then the file is dead weight in the repository and not in the
released package, which is the cheaper place for it to be.

One thing #16 should know before it decides how to read the file: the
`definitions` array holds exactly one element per Sense, so reading it as
`definitions[0]` is correct today and would silently drop data the moment the
budget is widened to two.

The shape the reader is expected to take, so #16 does not have to re-derive it:
the compressed bytes are decompressed once, and the decompressed JSON string is
dropped in favour of the parsed map rather than kept alongside it, so the
resident cost is one copy of the data rather than two.
