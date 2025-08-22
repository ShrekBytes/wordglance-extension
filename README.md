# WordGlance 📖

Get instant dictionary definitions and translations for any text on any website! Just select text and click the book icon.

> **🚨 For Chrome, Edge, Safari, and other browsers**:  
> Use the [WordGlance Userscript](https://github.com/ShrekBytes/WordGlance) — it works the same as the extension.  
>
> **Why no extension for Chromium-based browsers?**  
> Well… fu*k Google.


[![Install Firefox Extension](https://img.shields.io/badge/Install%20Firefox%20Extension-WordGlance-orange?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/firefox/addon/wordglance/)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/ShrekBytes/wordglance-extension)

![WordGlance Screenshot](/screenshots/dark.png)

## 📋 Table of Contents

- [✨ What it does](#-what-it-does)
- [🚀 How to install](#-how-to-install)
- [📱 How to use](#-how-to-use)
- [⚙️ Settings](#️-settings)
- [🌍 Supported languages](#-supported-languages)
- [❓ Common questions](#-common-questions)
- [👨‍💻 For developers](#-for-developers)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ What it does

- **📚 Dictionary**: Get definitions, examples, synonyms and antonyms
- **🌍 Translation**: Translate to 40+ languages instantly
- **⚡ Fast**: Smart caching for instant results
- **🎨 Beautiful**: Clean interface with dark mode
- **📱 Mobile-friendly**: Optimized for both desktop and mobile devices
- **🔧 Customizable**: Choose your languages and preferences

## 🚀 How to install

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

## 📱 How to use

### Desktop & Mobile

1. **Select text** - Highlight any word or phrase (double-tap on mobile, or long-press and drag)
2. **Click the 📖 icon** - It appears near your selection
3. **Browse results** - Use arrows to see more definitions/translations
4. **Adjust settings** - Click the extension icon in your toolbar → Settings

<img src="/screenshots/button.png" width="666" alt="WordGlance Button">
<img src="/screenshots/light.png" width="666" alt="WordGlance Light Mode">
<img src="/screenshots/dark.png" width="666" alt="WordGlance Dark Mode">

### 💡 Tips

- **Desktop**: Works with mouse selection, keyboard shortcuts, and double-click
- **Mobile**: Double-tap to select words, or long-press and drag for phrases
- Works best with **single words** for definitions
- Great at **short phrases** for translations
- Supports **40+ languages** including Spanish, French, German, Chinese, Japanese, Arabic, and more

## ⚙️ Settings

Click the extension icon to access settings:

- **🌙 Dark Mode** - Easy on the eyes for night browsing
- **🌍 Languages** - Choose source and target languages (defaults to Auto → English)
- **🗂️ Cache** - Clear stored data if needed

<img src="/screenshots/settings_dark.png" width="666" alt="Settings Dark Mode">
<img src="/screenshots/settings_light.png" width="666" alt="Settings Light Mode">

### Popular language combinations:

- English → Spanish (`en` → `es`)
- English → French (`en` → `fr`)
- Auto-detect → Chinese (`auto` → `zh`)
- Any language → English (`auto` → `en`)

## 🌍 Supported languages

**Major languages:** Arabic, Bengali, Chinese, English, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Russian, Spanish

**All 40+ languages (A-Z):** Amharic, Arabic, Bengali, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Filipino, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Malay, Norwegian, Polish, Portuguese, Romanian, Russian, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Zulu

## ❓ Common questions

**Q: Is it free?**  
A: Yes! Completely free and no ads.

**Q: Do I need to create an account?**  
A: Nope! Works instantly after installation.

**Q: Does it work on mobile?**  
A: Yes! Works flawlessly on both desktop and mobile devices.

**Q: Is my data safe?**  
A: Yes! Everything stays in your browser. No data is sent to us, and the extension is open source so you can inspect the code if you want to verify.

**Q: Why isn't it working?**  
A: Make sure the extension is installed and enabled. Try refreshing the page or restarting Firefox.

**Q: The translation seems wrong?**  
A: Try using "Auto-detect" for source language, or select specific languages in settings.

**Q: Does it work on all websites?**  
A: Yes! WordGlance works on any website where you can select text.

**Q: How do I change the target language?**  
A: Click the extension icon → Settings → Choose your language.

**Q: Why do some words show "No definition found"?**  
A: Very new words, slang, or technical terms might not be in the dictionary. Try synonyms or simpler terms.

**Q: Does it slow down my browser?**  
A: No! WordGlance is lightweight and only activates when you select text.

**Q: Can I translate entire sentences?**  
A: Yes, but it works best with 1-5 words. For longer text, use dedicated translation tools.

**Q: How do I disable it temporarily?**  
A: Click the extension icon → Toggle WordGlance off/on, or disable it in Firefox Add-ons manager.

**Q: Does it work offline?**  
A: No, it needs internet to fetch definitions and translations from online APIs.

**Q: What browsers are supported?**  
A: This extension is designed for Firefox. For Chrome, Edge, Safari, and other browsers, use the [WordGlance Userscript](https://github.com/ShrekBytes/WordGlance) instead.

**Have a question, suggestion, or found a bug?** [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) on GitHub and we'll help you out!

## 👨‍💻 For developers

### Extension Structure

- `manifest.json` - Extension configuration (Manifest V2)
- `background.js` - Background service worker
- `content.js` - Content script for webpage interaction
- `popup.js` - Settings popup interface
- `popup.html` - Settings popup HTML
- `popup.css` - Settings popup styling

### Configuration

The extension uses browser storage for user preferences:

- `wordglance-source-language` - Source language (default: 'auto')
- `wordglance-target-language` - Target language (default: 'en')
- `wordglance-dark-mode` - Dark mode toggle
- `wordglance-cache-definitions` - Cached dictionary results
- `wordglance-cache-translations` - Cached translation results

### APIs used

- **Dictionary**: [Dictionary API](https://dictionaryapi.dev/) - Free English dictionary
- **Translation**: [Free Translate API](https://ftapi.pythonanywhere.com/) - Multi-language translation

_Special thanks to these amazing free APIs that make WordGlance possible!_

## 🤝 Contributing

Found a bug? Want a feature? [Open an issue](https://github.com/ShrekBytes/wordglance-extension/issues) or submit a pull request!

_Love WordGlance? Give it a ⭐ star on GitHub!_

## 📄 License

Open source under [GPL-3.0 License](LICENSE)
