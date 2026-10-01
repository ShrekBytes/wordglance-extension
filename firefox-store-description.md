**WordGlance** - Your instant dictionary and translation companion!

**✨ What it does:**

- **Dictionary**: Get definitions, examples, synonyms, and antonyms instantly
- **Pronunciation**: Hear words read aloud with one tap, when audio is available
- **Translation**: See the word's equivalents in your target language, with several to choose between
- **Per-site control**: Turn WordGlance off on individual websites, right from the popup
- **Mobile-friendly**: Works perfectly on both desktop and mobile
- **Customizable**: Choose your preferred languages and settings

**How to use:**

1. Select a single word on any website
2. Click the 📖 icon that appears
3. Get instant definitions and translations
4. Click the ‹ › arrows to browse multiple results

A Lookup is about one word. The 📖 icon appears for a single word — WordGlance
does not translate a sentence, a phrase, or a passage. It shows that word's
equivalents in your target language, so you can pick the formal or the colloquial
one.

**Target languages** — the language you want a word's equivalents in. Coverage
depends on the source, because each pair comes from a different source: Wiktionary
where it has a Translations block, and a machine-translation fallback where it
does not, which is rougher and usually offers one word rather than several.

Amharic, Arabic, Bengali, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Filipino, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Zulu

**Definitions** are English-first. They come from a dictionary of the 19,555
commonest English words that ships inside the extension, and for other languages
from a live provider whose coverage we have measured for one language and not for
the rest. If you read in a language we have not measured, treat the quality as
unverified rather than good.

**Features:**

- Choose the language you are reading in, or leave it on auto-detect
- Customizable target language (defaults to English)
- Dark mode toggle
- Smart caching system
- Works on all websites (or turn it off per-site)
- No account required
- Completely free and open source

**Privacy & Security:**

- The word you select is sent straight from your browser to the services below — that is the only data that ever leaves it. WordGlance runs no servers, logs no lookups, and has no accounts.
- A **common English word costs at most a request**: definitions, examples, synonyms and antonyms for the 19,555 commonest words come from a dictionary bundled inside the extension. Where that dictionary carries only one of synonyms or antonyms — four words in ten of them, because Wiktionary lists antonyms far less often than synonyms — WordGlance asks Datamuse for the one it is missing, and only that one. Each answer is remembered, so it is asked for once. A rare word, and any Translation, cost a request.
- Your Definitions are resolved first, and your Translation is asked for afterwards. Within each, a service is contacted only when the ones before it had no answer:
  1. **Free Dictionary API** (freedictionaryapi.com) — only for a word the bundled dictionary does not carry
  2. **Datamuse** (api.datamuse.com) — for whichever of synonyms or antonyms neither has to show
  3. **Wiktionary** (en.wiktionary.org) — every Translation, for the word's equivalents in your target language and its pronunciation
  4. **Google** (clients5.google.com), **MyMemory** (api.mymemory.translated.net), **Bing** (www.bing.com) — free machine-translation fallbacks, in that order, reached only when Wiktionary lists no equivalent of your word in your target language. MyMemory and Bing answer with a single word where Wiktionary would have offered several to choose between, so a Translation from one of them is a fallback and a rougher one. They issue no cookie and require no sign-in.
- **Wikimedia Commons** (commons.wikimedia.org) is outside that sequence: it is contacted only when you press the pronunciation button, and it receives the recording's file name rather than your word.
- Your settings, cache, and per-site on/off list stay in your browser's local storage and are never transmitted
- No analytics, no tracking, no ads
- Open source code, so you can verify all of this yourself

**Attribution:**

Definitions, examples, synonyms and antonyms come from Wiktionary via the [kaikki.org](https://kaikki.org/dictionary/English/) extraction, with [wiktextract](https://github.com/tatuylonen/wiktextract), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Translations and pronunciation audio come from Wiktionary and Wikimedia Commons, under the same licence. Relations, where a dictionary entry carries none, come from [Datamuse](https://www.datamuse.com/).

**Browser Support:**

This extension is designed specifically for Firefox. There is no Chromium version, and the [WordGlance userscript](https://github.com/ShrekBytes/WordGlance) that used to serve one is archived and no longer maintained — it fetches from the page, so every service WordGlance now uses would have to allow it explicitly. If you were using the userscript, come here.

**Open Source:**

WordGlance is completely free and open source under the GPL-3.0 license. Feel free to contribute, report bugs, or request features on our [GitHub repository](https://github.com/ShrekBytes/wordglance-extension).

---

**❤️ Love WordGlance? Give it a ⭐ on GitHub!**
