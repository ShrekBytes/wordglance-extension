# WordGlance 📖

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

**What's sent, and where:** When you look up a selection, the word or phrase (plus your chosen source/target language codes) is sent directly from your browser to two services:

- [Dictionary API](https://dictionaryapi.dev/) for definitions, examples, synonyms, antonyms, and pronunciation audio
- [Free Translate API](https://translation-1e79fb3f3adb.herokuapp.com/) for translations

That's the only data that ever leaves your browser. WordGlance itself doesn't run any servers, doesn't log your lookups, doesn't use analytics or tracking, and doesn't have accounts. Your settings, cache, and per-site on/off list are stored locally in Firefox via `browser.storage.local` and are never transmitted anywhere.

**Permissions requested and why:**

- `storage` - save your settings and cache locally
- `activeTab` - read the current tab's hostname so the per-site toggle knows which site you're on
- Access to `api.dictionaryapi.dev` and the translation API domain - the two lookups above

## ❓ Common questions

**Q: Is it free?**  
A: Yes! Completely free and no ads.

**Q: Do I need to create an account?**  
A: Nope! Works instantly after installation.

**Q: Does it work on mobile?**  
A: Yes! Works flawlessly on both desktop and mobile devices.

**Q: Is my data safe?**  
A: Yes! WordGlance doesn't collect, store, or sell any data. The only thing that leaves your browser is the word or phrase you select, sent directly to the dictionary/translation APIs above to fetch results - see [Privacy & permissions](#privacy--permissions) for details. The extension is open source, so you can inspect the code yourself.

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
A: Selections are capped at 5 words / 100 characters, so it works best with short phrases. For longer text, use a dedicated translation tool.

**Q: How do I disable it temporarily?**  
A: Click the extension icon → toggle "Enable on This Site" off to disable WordGlance just for the site you're on (refresh the page after toggling). To turn it off everywhere, disable it from Firefox's Add-ons manager instead.

**Q: Does it work offline?**  
A: No, it needs internet to fetch definitions and translations from online APIs.

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

### APIs used

- **Dictionary**: [Dictionary API](https://dictionaryapi.dev/) - Free English dictionary
- **Translation**: [Free Translate API](https://translation-1e79fb3f3adb.herokuapp.com/) - Multi-language translation

Only the selected word/phrase and your chosen language codes are sent to these APIs - see [Privacy & permissions](#privacy--permissions).

_Special thanks to these amazing free APIs that make WordGlance possible!_

## Contributing

Found a bug? Want a feature? [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) or submit a pull request!

_Love WordGlance? Give it a ⭐ star on GitHub!_

## License

Open source under [GPL-3.0 License](LICENSE)
