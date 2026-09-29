# Translation is a dictionary Field, not a translation of the selection

A Lookup shows the headword's equivalent words in the reader's single Target language, several alternatives within that one language, never a rendering of the reader's selection. This reverses the original product, which machine-translated up to five words of selected text into one target language — the source of the ambiguity that made "translation" mean two things in one codebase.

Several alternatives inside one language is a hard requirement, not a nicety: a reader often needs to choose between the formal and the colloquial word. A provider that returns a single string is therefore a fallback and never a primary. Multi-word selections yield nothing at all and the trigger does not appear, because reviving phrase translation would put two meanings back on one gesture.

Wiktionary's page for the headword is the primary source for Translation and simultaneously carries the `{{audio}}` template, so one request serves two Fields. A Bangla headword structurally cannot contain a "translations into Bengali" row, so the case where the word is already in the Target language resolves to an empty Field without needing to be special-cased; the explicit Source-equals-Target setting is hidden locally rather than asked of any provider.
