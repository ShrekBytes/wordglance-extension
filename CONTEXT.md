# WordGlance

WordGlance is a Firefox extension that explains the single word a reader has selected, in place, on whatever page they are reading.

## Language

**Lookup**:
The act of asking about one selected word. A Lookup always concerns exactly one headword — WordGlance never interprets a phrase or a passage.
_Avoid_: Search, query, request

**Headword**:
The single word a Lookup is about.
_Avoid_: Query, term, keyword, selected text

**Field**:
One of the parallel kinds of information a Lookup returns about a headword: Definition, Example, Synonym, Antonym, Translation. A Lookup may leave a Field empty; empty is a normal outcome, not a failure.
_Avoid_: Section, tab, result type

**Sense**:
One of the distinct meanings a headword has. A Lookup returns several Senses in dictionary order, and each Sense carries its own Definitions, Examples, Synonyms and Antonyms. Those belong to the Sense — never to the headword as a whole, because a word's synonyms are usually only true of one of its meanings.
_Avoid_: Meaning (too vague), sub-entry, definition number

**Definition**:
The wording of a Sense. A Sense may carry more than one Definition, shown in dictionary order.
_Avoid_: Gloss (a gloss is a terse technical restatement, not a readable meaning)

**Example**:
A sentence showing the headword used in context.
_Avoid_: Sample, usage

**Synonym**:
A word that means the same as the headword. Shown as a bare word, never as its own Definition.
_Avoid_: Similar word, related word

**Antonym**:
A word that means the opposite of the headword. Shown as a bare word, never as its own Definition.
_Avoid_: Opposite word, counter word

**Translation**:
A word in the reader's Target language that means the same as the headword, presented as a Field beside the Definition. Several alternatives within that one language are normal and expected — a reader often needs to choose between the formal and the colloquial word. Never a translation of the reader's selection, and never a prose rendering of the headword's meaning.
_Avoid_: Machine translation, translation of text, rendering, sentence translation, "translate"

**Target language**:
The single language the reader wants the headword in. A Lookup shows at most one Target language, and may show several alternative words within it.
_Avoid_: Output language, destination language, locale, language set, target languages

**Tooltip**:
The small panel that appears beside the reader's selection and displays a Lookup's Fields.
_Avoid_: Popup (the settings Popup is a different thing entirely), card, bubble, overlay
