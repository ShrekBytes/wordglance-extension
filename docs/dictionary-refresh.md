# The bundled English dictionary

`data/wordglance-en-dictionary.json.gz` is the dictionary the extension ships.
It is generated once from a pinned upstream extraction and committed. It is not
built by CI and not built at release time.

The background script reads it and answers a Definition from it with no network
request at all. See [How the extension reads it](#how-the-extension-reads-it).

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
inherited. The extension reads this shape; if the Tooltip wants more than one
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

## How the extension reads it

`background.js` reads the artefact through `BUNDLED_DICTIONARY` in
`shared-constants.js` and answers a Definition from it before it looks at the
cache or the provider.

**Once, lazily.** The read is triggered by the first Definition Lookup and the
promise is memoised, so a burst of Lookups — or two arriving together while a
non-persistent background script is waking — share one read. Nothing is loaded at
startup: a reader who only ever translates would otherwise pay for 5 MB on every
wake to read none of it. A Translation Lookup does not touch the file at all.

**A relative path, not a URL.** `data/wordglance-en-dictionary.json.gz` resolves
against the background script's own document, so the read is from inside the
package: no host permission, and nothing leaves the machine. A test asserting a
Lookup is offline therefore asserts on the URLs requested *over the network*,
which the harness exposes as `networkUrls`; the packaged read is a file read, not
a request.

**Streamed, then dropped.** The compressed bytes go through a
`DecompressionStream`, so the 20 MB of decompressed JSON is never held alongside
the map it becomes. What stays resident is the parsed `entries` map, and the
text is unreachable once `JSON.parse` returns. Measured on the committed
artefact: **90 MB of resident heap** for the map, and **310 ms** to inflate and
parse it. Every Lookup after the first is a map lookup.

That heap figure is the real cost of this decision, and it is worth stating
plainly rather than only in the ADR's size comparison: a background script
holding 90 MB is well within what Firefox gives an extension, and it is
reclaimed when the script is unloaded. A reader who only ever translates never
pays it, because nothing is loaded until a Definition is asked for.

**A miss is a miss, not a failure.** A headword the bundle does not carry falls
through to the live provider unchanged, which is the design ADR-0002 describes
rather than a defect. A packaged file that is missing, unreadable, or not the
shape the generator writes is treated the same way: the read logs a warning once,
resolves to an empty map, and every Definition goes to the provider. A packaging
fault must not take the extension's main feature offline.

Two consequences of that, both deliberate. The failure is remembered rather than
retried, because every way a packaged read fails is permanent — the file is not
there, the gzip is truncated, the JSON is not the shape the generator writes, and
none of those change while the browser runs. And the read carries no timeout:
`CONFIG.apiTimeout` bounds a provider over the network, and aborting a cold
background page part-way through inflating 5 MB would send every Definition in
that session to the provider because the machine was briefly busy.

**Checked in a real browser, with no network at all.** The test suite cannot
answer the question that matters most about a packaged read, because the harness
serves the artefact itself: there is no network in the harness at all. So this
was measured in Firefox Developer Edition 157.0b5, one browser per condition and
**the same XPI in every condition**, with the package's `data/` listing measured
before the browser started — because a run that varies the package as well as the
network cannot attribute a failure to either. Each run drove a real Lookup with
real mouse input, on `happy` (in the bundle) and `pickaxe` (not in it), and read
the result from a screenshot.

| Condition | A provider fetch | Packaged read | `happy`'s Definitions |
| --- | --- | --- | --- |
| Live network | 200, 7,275 bytes | 200, 4,990,142 bytes | from the bundle |
| Browser offline mode | `NetworkError` | 200, 4,990,142 bytes | from the bundle |
| Loopback-only network namespace | `NetworkError` | 200, 4,990,142 bytes | from the bundle |
| Dead proxy | `NetworkError` | 200, 4,990,142 bytes | from the bundle |
| **Control: no `data/` in the package, same namespace** | `NetworkError` | **`NetworkError`** | **`Connection error - please try again`** |

The offline promise holds. The second row is a real offline condition rather
than an instrument: Firefox's own offline mode, `Services.io.offline = true`,
which is what the hamburger menu and airplane mode set, with `navigator.onLine`
false in the page. The Definition Field showed the bundle's own Senses while the
Translation Field reported its connection error, which is the split the design
asks for, and a second run read the same 4,990,142 bytes.

The namespace was not the cause. The last row is a control: the same namespace,
the same two headwords, and a package built without `data/`. It reproduces the
symptom an earlier check reported — `happy` answering `Connection error - please
try again`, which is only reachable when the packaged read returned nothing and
every provider was unreachable — and `dist/` still holds two 3.5.1 packages with
no `data/` directory at all. What is established is therefore two things rather
than one: a loopback-only namespace does not by itself stop Gecko serving a
`moz-extension://` read, and a package without `data/` produces exactly that
symptom. Which package that earlier run loaded is not recorded anywhere, so
naming it as the cause would be a guess — and a stale artefact in `dist/` is a
better candidate than the namespace, not a proven one. Issue #26 is the stale
artefact.

One limit worth stating: the error text does not separate the two causes, because
a file that is not there and a network that is not there both fail as
`NetworkError when attempting to fetch resource.` That is why the package is
measured rather than inferred from the failure. None of this is in the test
suite, because the check needs a real browser and reconstructing the harness is
most of the work, and `loadBundle` is unchanged on the strength of it.

**`data/` is in the XPI.** The release workflow zips an explicit file list, so
the artefact being committed is not by itself evidence that it ships. A test
asserts the file list contains it, because the failure otherwise is a published
extension that quietly falls back to the live provider for every word.

### What the payload can and cannot say

A Sense's `definitions` array is read element by element, not as
`definitions[0]`. One element per Sense is what the budget produces today, so
reading only the first would be correct now and would silently drop data the
moment the budget widened to two.

The Example is the other place the payload is narrower than the data. A Sense
carries one Example and the payload pairs one Example with one Definition, so the
Sense's Example goes with the first Definition it shows. Same reason: the budget
makes that unambiguous today and the code should not depend on it staying that
way.

Synonyms and Antonyms are the Senses' own, walked in dictionary order and
deduplicated, and multi-word phrases are filtered at the reader as well as at
build time. What the payload *cannot* express, because the Tooltip shows one list
per Lookup rather than one per Sense, is which Sense each of them came from — so a
reader on the second page of Definitions is reading a list drawn from all of
them. The flattening ADR-0002 forbids is the entry-level dump, which the artefact
does not contain at all; making the relations Sense-specific on screen as well is
a change to the Tooltip, not to this ticket.

The part of speech is the one place the reader rewrites the data rather than
passing it through. Wiktionary's tags are abbreviations — `adj`, `adv`,
`prep_phrase` — and the Tooltip prints the part of speech on its own line, so
passing them through would put "adj" on screen where the provider path puts
"adjective". `PART_OF_SPEECH` in `background.js` spells out the 21 tags the
artefact actually contains, measured rather than guessed; a tag a future refresh
introduces falls through to the tag itself, which shows the reader something
rather than nothing.

### Two things the bundle does not do

**It carries no audio.** A Lookup that must not touch the network cannot go and
get a pronunciation, so a bundled Lookup returns an empty `audio` and the
Tooltip's pronounce button stays hidden — the Field's documented empty outcome
rather than a broken control. Pronunciation arrives with the Wiktionary reader in
issue #17. This is a visible change for a reader who had a pronounce button for a
common word, and it is the one regression this ticket accepts.

**It is not written to the persisted cache.** The cache exists to stop a request
being made, and a bundled Lookup makes none; writing every common word a reader
looks up would fill extension storage with a copy of data the package already
holds. It is also why the bundle is consulted before the cache: a word in both
should show the bundle's Senses rather than whatever a provider said about it
last week.
