# WordGlance (Firefox MV2)

This is a Firefox Manifest V2 port of the WordGlance userscript. It injects a content script that mounts a Shadow DOM to isolate styles for the trigger button and tooltip. It preserves the original features: selection-triggered definition and translation lookup, pagination, dark mode, language settings, cache, and usage counter.

## Load temporarily in Firefox

1. Open about:debugging#/runtime/this-firefox
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` inside this `extension/` folder.

The extension will run on all pages (matches: <all_urls>). Select text on a page, click the 📖 bubble to see definition and translation.

Use the page context menu "WordGlance Settings" or Alt+W to open the settings dialog.

## Notes

- Network: Uses dictionaryapi.dev and libretranslate endpoints. If direct fetch is blocked, background fetch proxy is used.
- Storage: Uses `browser.storage.local` for settings, cache, and usage counter.
- Isolation: UI rendered inside Shadow DOM to avoid style conflicts.
