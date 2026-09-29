---
status: superseded by ADR-0002
---

# WordGlance stays a thin client over third-party free APIs

WordGlance sends every Lookup to a third-party web service. We deliberately rejected bundling lexical data, user-supplied API keys, and extending the local cache to survive an API outage. This was chosen knowingly, after the safer options were put to the project and declined.

Firefox exposes no dictionary or translation API to extensions — `browser.translations` and `browser.dictionary` have never shipped — and the bundled `en-US.dic` is a headword-only Hunspell spellcheck list with no definitions, synonyms, antonyms, or examples. So there is no native fallback to hide behind. The two services WordGlance depended on both died: `api.dictionaryapi.dev` stopped responding, and the Heroku translation host now returns HTTP 200 while echoing the input back untranslated.

The reasoning: WordGlance's value is that it is zero-setup and works the moment it is installed. Bundling a dictionary multiplies the package size and forks the data away from its upstream; a key field asks every user to register at some provider before looking up their first word; a durable cache trades storage and staleness for resilience against a failure mode that was accepted.

The cost, stated plainly: WordGlance's availability is only ever as good as endpoints that can disappear without notice, and the cache is cleared on every browser startup, so an endpoint failure is immediate, total, and leaves every user with nothing to fall back on. When that happens, the fix is revisiting this decision. Do not quietly remove the cache-clearing on its own — that would silently reverse half of it and leave the reasoning unexplained.
