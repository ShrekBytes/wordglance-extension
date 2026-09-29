# WordGlance 📖

> ⚠️ **Project Status: Paused**
>
> Development of the WordGlance Firefox extension is currently paused. The free APIs this extension depends on for dictionary definitions and translations are no longer working reliably, so the extension may not function as expected right now.
>
> Development will resume once suitable free APIs for translation, dictionary definitions, and related features are available again.

Get instant dictionary definitions and translations for any text on any website! Just select text and click the book icon.

> **For Chrome, Edge, Safari, and other browsers**:  
> Use the [WordGlance Userscript](https://github.com/ShrekBytes/WordGlance) — it works the same as the extension.
>
> **Why no extension for Chromium-based browsers?**  
> Cause… fu\*k Google.

![Extension Badge](assets/icon_128.png) [![GreasyFork](https://img.shields.io/badge/GreasyFork-Userscript-4E9A06?style=for-the-badge&logo=greasyfork)](https://greasyfork.org/en/scripts/546617-wordglance-dictionary-translation-tooltip)
[![Firefox](https://img.shields.io/badge/Firefox-Add--on-orange?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/firefox/addon/wordglance/)

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
- **Translation**: Translate to 40+ languages instantly
- **Per-site control**: Turn WordGlance off on individual websites without disabling the whole extension
- **Fast**: Smart caching for instant results
- **Beautiful**: Clean interface with dark mode
- **Mobile-friendly**: Optimized for both desktop and mobile devices
- **Customizable**: Choose your languages and preferences

## How to install

Requires Firefox 142 or later.

### Firefox Extension Installation

**Option 1 (Recommended):** [Install from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/wordglance/)

**Option 2:** Manual installation

1. Download the extension files from this repository
2. Open Firefox and go to `about:debugging`
3. Click "This Firefox" tab
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from the downloaded folder

### Alternative: Userscript Version

If you prefer a userscript or use other browsers, check out the [WordGlance Userscript](https://github.com/ShrekBytes/WordGlance) which works on Chrome, Edge, Safari, and other browsers.

## How to use

### Desktop & Mobile

1. **Select text** - Highlight any word or phrase (double-tap on mobile, or long-press and drag)
2. **Click the 📖 icon** - It appears near your selection
3. **Browse results** - Click the ‹ › arrows to page through multiple definitions or translations
4. **Adjust settings** - Click the extension icon in your toolbar → Settings

<img src="/screenshots/button.png" width="666" alt="WordGlance Button">
<img src="/screenshots/light.png" width="666" alt="WordGlance Light Mode">
<img src="/screenshots/dark.png" width="666" alt="WordGlance Dark Mode">

### Tips

- **Desktop**: Works with mouse selection, keyboard shortcuts, and double-click
- **Mobile**: Double-tap to select words, or long-press and drag for phrases
- Works best with **single words** for definitions
- Selections are capped at **5 words / 100 characters** - for longer passages, use a dedicated translation tool
- Press **Escape** to dismiss the tooltip
- Supports **40+ languages** including Spanish, French, German, Chinese, Japanese, Arabic, and more

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

**A common word reaches nobody.** WordGlance ships its own English dictionary inside the extension — 19,555 of the commonest English words, covering 98.6% of the words you will meet in running text — so a common word is answered from the package without a request leaving your machine. Which services a word *does* reach depends on what it is missing — every one below is only contacted after the one before it came up empty:

- **[Wiktionary](https://en.wiktionary.org/)** — every Translation. The word goes to its own page, which also carries the pronunciation recording.
- **[Wikimedia Commons](https://commons.wikimedia.org/)** — only when you press the pronunciation button. It receives the recording's file name, not the word.
- **[Free Dictionary API](https://freedictionaryapi.com/)** — only for a word the bundled dictionary has no entry for. It receives the word and the language you are reading it in.
- **[Datamuse](https://api.datamuse.com/)** — only when neither of those has synonyms or antonyms to show. It receives the word.
- **[Google](https://www.google.com/)** — only when Wiktionary lists no equivalent of your word in your target language. It receives the word and your language choice.
- **[MyMemory](https://mymemory.translated.net/)** — only if Google doesn't answer.
- **[Bing](https://www.bing.com/)** — only if neither Google nor MyMemory answers. It issues an anonymous session token, which WordGlance echoes back with your word. No sign-in and no cookie is involved.

The last three are free machine-translation services, reached only for a word Wiktionary has no equivalent of, and each only when the one before it didn't answer. They are what stops a gap in Wiktionary's coverage from leaving the Translation Field empty. The last two answer with a single word where Wiktionary would have offered you several to choose between, so a Translation from one of them is a fallback, and a rougher one. `[Why they are there](docs/adr/0005-machine-translation-fallback-chain.md)` records the reasoning, including the terms those services impose on automated access.

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
A: Yes! WordGlance doesn't collect, store, or sell any data. The only thing that leaves your browser is the word you selected, sent straight to the services listed above — and for a common word, nothing leaves at all. See [Privacy & permissions](#privacy--permissions) for exactly which service is contacted when. The extension is open source, so you can inspect the code yourself.

**Q: Why isn't it working?**  
A: Make sure the extension is installed and enabled. Try refreshing the page or restarting Firefox.

**Q: The translation seems wrong?**  
A: Try using "Auto-detect" for source language, or select specific languages in settings.

**Q: Does it work on all websites?**  
A: Yes, unless you've turned it off for that specific site in Settings.

**Q: How do I change the target language?**  
A: Click the extension icon → Settings → Choose your language.

**Q: Why do some words show "Definition not found"?**  
A: Very new words, slang, or technical terms might not be in the dictionary. Try synonyms or simpler terms.

**Q: Does it slow down my browser?**  
A: No! WordGlance is lightweight and only activates when you select text.

**Q: Can I translate entire sentences?**  
A: No. A Lookup is about one selected word, and the button only appears for a single word. WordGlance shows that word's equivalents in your target language, not a translation of your selection.

**Q: How do I disable it temporarily?**  
A: Click the extension icon → toggle "Enable on This Site" off to disable WordGlance just for the site you're on (refresh the page after toggling). To turn it off everywhere, disable it from Firefox's Add-ons manager instead.

**Q: Does it work offline?**  
A: Partly. Definitions, examples, synonyms and antonyms for the 19,555 commonest English words are served from a dictionary bundled inside the extension, so those keep working with no connection. A rarer word, and every Translation, needs the internet.

**Q: What browsers are supported?**  
A: This extension is designed for Firefox. For Chrome, Edge, Safari, and other browsers, use the [WordGlance Userscript](https://github.com/ShrekBytes/WordGlance) instead.

**Have a question, suggestion, or found a bug?** [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) on GitHub and we'll help you out!

## For developers

### Extension Structure

- `manifest.json` - Extension configuration (Manifest V2)
- `shared-constants.js` - Storage keys, message types, supported languages, and error messages shared by every script
- `shared-utilities.js` - Shared helpers used across scripts: storage access, per-site enable/disable list, text sanitizing, debounce, LRU cache, fetch-with-timeout
- `background.js` - Non-persistent background script; handles API calls, caching, and settings
- `content.js` - Content script injected on every page; detects text selection and renders the tooltip
- `popup.js` - Settings popup interface
- `popup.html` - Settings popup HTML
- `popup.css` - Settings popup styling

### Configuration

The extension uses browser storage for user preferences:

- `wordglance-source-language` - Source language (default: 'auto')
- `wordglance-target-language` - Target language (default: 'en')
- `wordglance-dark-mode` - Dark mode toggle
- `wordglance-disabled-sites` - Hostnames where WordGlance is turned off
- `wordglance-cache-definitions` - Cached dictionary results
- `wordglance-cache-translations` - Cached translation results

### Where the data comes from

- **Bundled dictionary** (`data/wordglance-en-dictionary.json.gz`) - the 19,555 commonest English words, built from a [kaikki.org Wiktionary extraction](https://kaikki.org/dictionary/English/) with [wiktextract](https://github.com/tatuylonen/wiktextract). Wiktionary content, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Read out of the package; it never leaves your machine. Regenerate it with `npm run build:dictionary` - see [docs/dictionary-refresh.md](docs/dictionary-refresh.md).
- **Dictionary**: [Free Dictionary API](https://freedictionaryapi.com/) - words the bundle does not carry. Wiktionary content, CC BY-SA 4.0.
- **Relations**: [Datamuse](https://api.datamuse.com/) - synonyms and antonyms, only when neither of the above has any
- **Translation and pronunciation**: [Wiktionary](https://en.wiktionary.org/) - the word's equivalents in your target language, and the recording to play
- **Translation fallbacks**, reached only when Wiktionary has no equivalent: [Google](https://www.google.com/), [MyMemory](https://mymemory.translated.net/), then [Bing](https://www.bing.com/) - see [ADR-0005](docs/adr/0005-machine-translation-fallback-chain.md)

Only the selected word, a language code, and (for Bing) an anonymous session token are sent - see [Privacy & permissions](#privacy--permissions).

_Special thanks to these amazing free services that make WordGlance possible!_

## Contributing

Found a bug? Want a feature? [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) or submit a pull request!

_Love WordGlance? Give it a ⭐ star on GitHub!_

## License

Open source under [GPL-3.0 License](LICENSE)
