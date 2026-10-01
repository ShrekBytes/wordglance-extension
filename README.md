# WordGlance 📖

Select a single word on any page and WordGlance explains it where you are — its
Definitions, Examples, Synonyms, Antonyms, and its equivalents in your target
language, without leaving the page you are reading.

> **Looking for Chrome, Edge, or Safari?**
> There is no extension for Chromium-based browsers. The
> [WordGlance userscript](https://github.com/ShrekBytes/WordGlance) that used to
> serve them is archived and no longer maintained — a userscript fetches from the
> page, so every service WordGlance now uses would have to allow it explicitly.
> If that is the browser you have, this extension is not for you.
>
> **Why no extension for Chromium-based browsers?**
> Cause… fu\*k Google.

![Extension Badge](assets/icon_128.png) [![Firefox](https://img.shields.io/badge/Firefox-Add--on-orange?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/firefox/addon/wordglance/)

![WordGlance Screenshot](/screenshots/dark.png)

## Table of Contents

- [What it does](#what-it-does)
- [How to install](#how-to-install)
- [How to use](#how-to-use)
- [Settings](#settings)
- [Supported languages](#supported-languages)
- [Privacy & permissions](#privacy--permissions)
- [Common questions](#common-questions)
- [For developers](#for-developers)
- [Contributing](#contributing)
- [License](#license)

## ✨ What it does

- **Dictionary**: Get definitions, examples, synonyms and antonyms
- **Pronunciation**: Tap the 🔊 icon to hear a word read aloud, when audio is available
- **Translation**: See the word's equivalents in your target language, with several to choose between
- **Per-site control**: Turn WordGlance off on individual websites without disabling the whole extension
- **Fast**: A dictionary inside the extension, so a common word's Definitions and Examples are answered without a request leaving your machine
- **Beautiful**: Clean interface with dark mode
- **Mobile-friendly**: Optimized for both desktop and mobile devices
- **Customizable**: Choose your languages and preferences

## How to install

Requires Firefox 142 or later.

**Option 1 (Recommended):** [Install from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/wordglance/)

**Option 2:** Manual installation

1. Download the extension files from this repository
2. Open Firefox and go to `about:debugging`
3. Click "This Firefox" tab
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from the downloaded folder

## How to use

### Desktop & Mobile

1. **Select a word** - Highlight a single word (double-tap on mobile, or long-press and drag)
2. **Click the 📖 icon** - It appears near your selection
3. **Browse results** - Click the ‹ › arrows to page through multiple definitions or translations
4. **Adjust settings** - Click the extension icon in your toolbar → Settings

<img src="/screenshots/button.png" width="666" alt="WordGlance Button">
<img src="/screenshots/light.png" width="666" alt="WordGlance Light Mode">
<img src="/screenshots/dark.png" width="666" alt="WordGlance Dark Mode">

### Tips

- **Desktop**: Works with mouse selection, keyboard shortcuts, and double-click
- **Mobile**: Double-tap to select a word, or long-press and drag over it
- A Lookup is about **one word**. The 📖 icon does not appear for a phrase or a sentence, and WordGlance never translates a passage — it shows that word's equivalents in your target language, not a translation of what you selected
- Press **Escape** to dismiss the tooltip
- Supports **40+ target languages** including Spanish, French, German, Chinese, Japanese, Arabic, and more

## Settings

Click the extension icon to access settings:

- **Dark Mode** - Easy on the eyes for night browsing
- **Languages** - Choose source and target languages (defaults to Auto → English)
- **Enable on This Site** - Turn WordGlance off just for the site you're currently on (refresh the page after toggling)
- **Cache** - Clear stored data if needed

<img src="/screenshots/settings.png" width="666" alt="Settings Dark Mode">

### Popular language combinations:

- English → Spanish (`en` → `es`)
- English → French (`en` → `fr`)
- Auto-detect → Chinese (`auto` → `zh`)
- Any language → English (`auto` → `en`)

## Supported languages

**Major languages:** Arabic, Bengali, Chinese, English, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Russian, Spanish

**All 40+ languages (A-Z):** Amharic, Arabic, Bengali, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Filipino, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Zulu

## Privacy & permissions

**What's sent, and where:** the word you selected, and nothing else. No account, no analytics, no cookies, and nothing about you stored anywhere but your own machine. WordGlance runs no servers of its own, doesn't log your lookups, and keeps your settings, cache, and per-site on/off list in Firefox's local storage, where they stay.

**A common word stays on your machine, and usually stops there.** WordGlance ships its own English dictionary inside the extension — 19,555 of the commonest English words, covering 98.6% of the words you will meet in running text — so a common word's Definitions, Examples and relations are read from the package rather than requested. Which services a word *does* reach depends on what it is missing. Your Definitions are resolved first and your Translation is asked for afterwards, and within each, a service is contacted only after the one before it came up empty:

- **[Free Dictionary API](https://freedictionaryapi.com/)** (`freedictionaryapi.com`) — only for a word the bundled dictionary has no entry for. It receives the word and the language you are reading it in.
- **[Datamuse](https://www.datamuse.com/)** (`api.datamuse.com`) — for whichever of synonyms or antonyms neither of those has to show. The bundled dictionary carries only one of the two for about four words in ten, because Wiktionary lists antonyms far less often than synonyms, so this is reached far more often than not. It receives the word. Each answer is remembered, so it is asked for once.
- **[Wiktionary](https://en.wiktionary.org/)** (`en.wiktionary.org`) — every Translation. The word goes to its own page, which also carries the pronunciation recording.
- **[Google](https://translate.google.com/)** (`clients5.google.com`) — only when Wiktionary lists no equivalent of your word in your target language. It receives the word and your language choice.
- **[MyMemory](https://mymemory.translated.net/)** (`api.mymemory.translated.net`) — only if Google doesn't answer.
- **[Bing](https://www.bing.com/translator)** (`www.bing.com`) — only if neither Google nor MyMemory answers. It issues an anonymous session token, which WordGlance echoes back with your word. No sign-in and no cookie is involved.

**Wikimedia Commons** (`commons.wikimedia.org`) sits outside that sequence: it is contacted only when you press the pronunciation button, and it receives the recording's file name rather than your word.

The host in backticks after each name is the one that actually receives your word, which is not always the one the name suggests. The last three are free machine-translation services, reached only for a word Wiktionary has no equivalent of, and each only when the one before it didn't answer. They are what stops a gap in Wiktionary's coverage from leaving the Translation Field empty. The last two answer with a single word where Wiktionary would have offered you several to choose between, so a Translation from one of them is a fallback, and a rougher one. `[Why they are there](docs/adr/0005-machine-translation-fallback-chain.md)` records the reasoning, including the terms those services impose on automated access.

The same disclosure is in the extension's own settings, under **Where your word goes**, so you do not have to leave the browser to find it.

Turning Definitions or Translations off in settings stops those requests entirely.

**Permissions requested and why:**

- `storage` - save your settings and cache locally
- `activeTab` - read the current tab's hostname so the per-site toggle knows which site you're on
- Access to `en.wiktionary.org`, `commons.wikimedia.org`, `freedictionaryapi.com`, `api.datamuse.com`, `clients5.google.com`, `api.mymemory.translated.net`, and `www.bing.com` - the seven services above, and nothing else
## ❓ Common questions

**Q: Is it free?**  
A: Yes! Completely free and no ads.

**Q: Do I need to create an account?**  
A: Nope! Works instantly after installation.

**Q: Does it work on mobile?**  
A: Yes! Works flawlessly on both desktop and mobile devices.

**Q: Is my data safe?**  
A: Yes! WordGlance doesn't collect, store, or sell any data. The only thing that leaves your browser is the word you selected, sent straight to the services listed above — and for a common word, its Definitions and Examples never leave at all. See [Privacy & permissions](#privacy--permissions) for exactly which service is contacted when. The extension is open source, so you can inspect the code yourself.

**Q: Why isn't it working?**  
A: Make sure the extension is installed and enabled. Try refreshing the page or restarting Firefox.

**Q: The translation seems wrong?**  
A: Try using "Auto-detect" for source language, or select specific languages in settings.

**Q: Does it work on all websites?**  
A: Yes, unless you've turned it off for that specific site in Settings.

**Q: How do I change the target language?**  
A: Click the extension icon → Settings → Choose your language.

**Q: Why do some words show "Definition not found"?**  
A: Nothing defines that word. A rare technical term, a name, or a very new coinage may be in none of the sources WordGlance asks — and "Definition not found" is a real answer, not a broken extension. "Connection error" is the other thing you can see, and it means the opposite: the request failed, so WordGlance does not yet know. Turning Definitions or Translations off in settings removes that Field from the tooltip altogether, rather than filling it with an explanation.

**Q: Does it slow down my browser?**  
A: No! WordGlance is lightweight and only activates when you select text.

**Q: Can I translate entire sentences?**  
A: No, and it is not a missing feature. A Lookup is about one selected word, and the 📖 button only appears for a single word. WordGlance shows that word's equivalents in your target language — so you can pick the formal or the colloquial one — not a translation of your selection.

**Q: How do I disable it temporarily?**  
A: Click the extension icon → toggle "Enable on This Site" off to disable WordGlance just for the site you're on (refresh the page after toggling). To turn it off everywhere, disable it from Firefox's Add-ons manager instead.

**Q: Does it work offline?**  
A: Partly. Definitions, examples, synonyms and antonyms for the 19,555 commonest English words are served from a dictionary bundled inside the extension. Where that dictionary carries only one of synonyms or antonyms, the missing one is asked of Datamuse and remembered — so a common word needs a connection the first time you look it up and not again. A rarer word, and every Translation, needs the internet.

**Q: What browsers are supported?**  
A: This extension is Firefox only, and only on version 142 or later. There is no Chromium version, and the [userscript](https://github.com/ShrekBytes/WordGlance) that used to serve Chrome, Edge and Safari is archived and no longer maintained — it fetches from the page, so every service WordGlance now uses would have to allow it explicitly.

**Have a question, suggestion, or found a bug?** [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) on GitHub and we'll help you out!

## For developers

### Extension Structure

- `manifest.json` - Extension configuration (Manifest V2)
- `shared-constants.js` - Storage keys, message types, supported languages, and error messages shared by every script
- `shared-utilities.js` - Shared helpers used across scripts: storage access, settings read and write, per-site enable/disable list, headword normalisation, debounce, LRU cache, fetch-with-timeout
- `background.js` - Non-persistent background script; handles API calls, caching, and settings
- `wiktionary.js` - Parses the Wiktionary page for the headword's Translation Field and its recording
- `content.js` - Content script injected on every page; detects text selection and renders the tooltip
- `popup.js` - Settings popup interface
- `popup.html` - Settings popup HTML
- `popup.css` - Settings popup styling

### Configuration

The extension keeps its preferences and its cached answers in `browser.storage.local`. Every preference is declared once, as an in-memory key with its storage key and its default, in `SETTINGS_SCHEMA` (`shared-constants.js`) - a setting added there needs no edit to this file. Three further keys hold cached answers rather than preferences: `wordglance-cache-definitions`, `wordglance-cache-translations` and `wordglance-cache-thesaurus`.

### Where the data comes from

- **Bundled dictionary** (`data/wordglance-en-dictionary.json.gz`) - the 19,555 commonest English words, built from a [kaikki.org Wiktionary extraction](https://kaikki.org/dictionary/English/) with [wiktextract](https://github.com/tatuylonen/wiktextract). Wiktionary content, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Read out of the package; it never leaves your machine. Regenerate it with `npm run build:dictionary` - see [docs/dictionary-refresh.md](docs/dictionary-refresh.md).
- **Dictionary**: [Free Dictionary API](https://freedictionaryapi.com/) - words the bundle does not carry. Wiktionary content, CC BY-SA 4.0.
- **Relations**: [Datamuse](https://api.datamuse.com/) - whichever of synonyms or antonyms the two above are missing, asked for one at a time
- **Translation and pronunciation**: [Wiktionary](https://en.wiktionary.org/) - the word's equivalents in your target language, and the recording to play
- **Translation fallbacks**, reached only when Wiktionary has no equivalent: Google (`clients5.google.com`), MyMemory (`api.mymemory.translated.net`), then Bing (`www.bing.com`) - see [ADR-0005](docs/adr/0005-machine-translation-fallback-chain.md)

Only the selected word, a language code, and (for Bing) an anonymous session token are sent - see [Privacy & permissions](#privacy--permissions).

_Special thanks to these amazing free services that make WordGlance possible!_

## Contributing

Found a bug? Want a feature? [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) or submit a pull request!

_Love WordGlance? Give it a ⭐ star on GitHub!_

## License

Open source under [GPL-3.0 License](LICENSE)
