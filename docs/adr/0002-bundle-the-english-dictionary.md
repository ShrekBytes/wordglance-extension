# Bundle the English dictionary; the network serves Translation, and a missing relation

WordGlance ships a roughly 4–6 MB English dictionary inside the XPI and serves Definition, Example, Synonym and Antonym from it. A miss falls back to `freedictionaryapi.com`. Datamuse fills **each** of Synonym and Antonym that neither of those has — one Field at a time, not both or neither. Translation always touches the network on the common path, and so does Datamuse — for 94.2% of bundled headwords, once each, for the relation the bundle is missing.

## Amended: the network promise, 2026-09-30

This ADR originally read "Datamuse fills Synonym and Antonym only when both of those come up empty. Only Translation touches the network on the common path." Both halves of that are now narrower, and the reason is measured rather than felt.

The gate was written over the two relations at once, on the assumption that a source has both or neither. Wiktionary does not: it lists Antonyms far less often than Synonyms. Across the artefact's 19,555 headwords, **40.5% carry exactly one of the two** and only 5.8% carry both. So "has some" was read as "has both", and a Lookup of a word like `good` — synonyms in the package, antonyms nowhere — showed a Synonym line and no Antonym line, which reads to a reader as the word having no opposite rather than as the one source having none.

The fix is to fill each Field on its own. What it costs is the offline promise above: the 94.2% of bundled headwords that are not one-sided-in-both-directions now reach Datamuse once for whatever relation they lack, against 0% before. The thesaurus's answers are cached per headword per relation, so that is once per word rather than once per Lookup — which is what keeps the cost bounded, and why the cache is a third store rather than an entry in the definitions cache: the bundle answers *before* the definitions cache is read, so a relation remembered there would never be read again.

Two things deliberately unchanged. A Field a source *did* fill is never topped up from the thesaurus: a Sense's relations belong to that Sense and a thesaurus word belongs to the headword as a whole, so padding a one-word list to six would trade a short list that is true of this meaning for a longer one that is not. And a thesaurus that fails, or has nothing, leaves the Field empty — CONTEXT.md's "empty is a normal outcome" — rather than failing a Lookup whose Definitions have already resolved.

The underlying decision is untouched. A committed artefact still makes four of the five Fields immune to the failure class that `api.dictionaryapi.dev` and `freedictionaryapi.com` both represent, at a package size that sits forty times under the AMO 200 MB limit; the artefact is still read without a request, and a common word's Definitions and Examples still cost nothing.

This supersedes ADR-0001, which chose the opposite. The reason is the failure we just lived through rather than a change of taste. `api.dictionaryapi.dev` is a single anonymous maintainer who burned out; `freedictionaryapi.com` has the same profile — no organisation, no status page, no published rate limit, an OpenAPI spec that 404s. A committed artefact makes four of the five Fields immune to that entire class of failure, at a package size that sits forty times under the AMO 200 MB limit.

The bundle is generated once from kaikki.org's Wiktionary extraction and committed, with a documented refresh procedure and a date stamp in the file. A dictionary that silently rots is its own failure mode: words that used to resolve would quietly stop resolving, and nobody would notice. Datamuse stays in the chain for one reason only — its `rel_syn` and `rel_ant` are WordNet-backed and clean, where Wiktionary's entry-level lists are unsorted dumps. It is never used for Definitions because it has no example sentences and thin part-of-speech data.

## Sizing, measured

The word list is the FrequencyWords English list, pinned at a known commit — a single 622 KB text file of word and count, needing no tooling to obtain. Filtering to alphabetic tokens leaves 46,717 candidates.

The cut-off is the top 20,000 of those. Chosen on token coverage rather than headword count, because headword count is the wrong question: the measure that matters is how much running English the bundle can answer without a network. The top 20,000 headwords account for 98.6% of all word tokens in the corpus, against 99.4% at 30,000 and 93.6% at 5,000.

Per-word budget: first gloss truncated to 220 characters, one Example, four Synonyms, four Antonyms, eight Senses. Measured at 215 bytes per headword gzipped, giving **4.3 MB for 20,000 headwords**. Truncating further buys almost nothing — 140-character glosses measured 211 bytes, so the saving is inside the noise. Widening to the full 46,717 list instead costs 10–13 MB for 0.14% more coverage, which is not worth tripling the package.

Roughly nine in ten of the 20,000 have a Wiktionary record. The remainder are not lost: they fall through to the live provider, which is what the chain in this ADR is for. Measured coverage of the source falls from 92% in the most frequent decile to 48% in the least, which is expected and is the argument for the live fallback rather than against it.

The artefact is generated by streaming the upstream extraction, not by fetching each headword individually. Per-word retrieval runs at about 1.4 requests per second single-threaded, which is roughly nine hours for the candidate list; the bulk file is the faster path by a wide margin. The artefact is stored compressed and decompressed on load, so the installed package carries the compressed size rather than the expanded one.
