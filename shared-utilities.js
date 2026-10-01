/*
  Shared Utilities: WordGlance Extension
  Common utility functions and configuration used across all scripts
*/

const CONFIG = {
  tooltipZIndex: 999999,
  maxDefinitions: 9,
  maxTranslations: 8,
  definitionsPerPage: 3,
  translationsPerPage: 4,
  maxSynonyms: 6,
  maxAntonyms: 6,
  // A Lookup is about one headword (see HeadwordUtils), so this is a
  // plausibility bound rather than a selection cap: long enough for the longest
  // compound in a corpus dictionary, short enough that a run of one repeated
  // character cannot become a provider URL.
  maxHeadwordLength: 64,
  maxMirrorFieldLength: 20000,
  cacheSize: 500,
  apiTimeout: 10000,
  // A shorter budget for the Translation Field's fallback chain, which asks up
  // to three more providers after the primary. The full timeout on each of them
  // would let a Lookup that is going to come up empty hold the reader for half
  // a minute to learn so, which is the failure the old dead provider caused and
  // the one this chain exists to stop repeating. A fallback that cannot answer
  // in four seconds is a fallback that is down.
  fallbackTimeout: 4000,
  debounceDelay: 100,
  cacheSaveDelay: 2000 // Debounce cache saving
};

const StorageUtils = {
  async get(keys) {
    try {
      const result = await browser.storage.local.get(keys);
      return result;
    } catch (e) {
      console.warn('Storage get error:', e);
      return {};
    }
  },

  async set(items) {
    try {
      await browser.storage.local.set(items);
      return true;
    } catch (e) {
      console.warn('Storage set error:', e);
      return false;
    }
  },

  // Returns the stored value if the key is present, otherwise the default.
  // Using Object.hasOwn (not ||) ensures explicit false/0 values aren't lost, and avoids
  // calling hasOwnProperty directly on an object that could in principle lack it on its prototype.
  getValue(stored, key, defaultValue) {
    return Object.hasOwn(stored, key) ? stored[key] : defaultValue;
  }
};

// Centralizes the settings shape (SETTINGS_SCHEMA, in shared-constants.js) so
// background.js, content.js, and popup.js don't each hand-roll their own copy of
// "these are the keys, these are their storage keys, these are their defaults".
const SettingsUtils = {
  // A plain object of in-memory defaults, e.g. { targetLanguage: 'en', darkMode: false, ... }
  createDefaults() {
    const settings = {};
    for (const [key, { default: def }] of Object.entries(SETTINGS_SCHEMA)) {
      settings[key] = def;
    }
    return settings;
  },

  // Reads every settings key from storage in one call and resolves each to its
  // real value or default.
  async loadFromStorage() {
    const storageKeys = Object.values(SETTINGS_SCHEMA).map(s => s.storageKey);
    const stored = await StorageUtils.get(storageKeys);

    const settings = {};
    for (const [key, { storageKey, default: def }] of Object.entries(SETTINGS_SCHEMA)) {
      settings[key] = StorageUtils.getValue(stored, storageKey, def);
    }
    return settings;
  },

  // Applies any changed keys from a browser.storage.onChanged `changes` object onto
  // `target` in place. Returns the list of in-memory settings keys that were updated
  // (e.g. ['darkMode']) so callers can run their own key-specific side effects.
  applyChanges(target, changes) {
    const updatedKeys = [];
    for (const [key, { storageKey, default: def }] of Object.entries(SETTINGS_SCHEMA)) {
      if (changes[storageKey]) {
        // Nullish coalescing (not ||) so an explicit false/0 isn't replaced by the default
        target[key] = changes[storageKey].newValue ?? def;
        updatedKeys.push(key);
      }
    }
    return updatedKeys;
  }
};

// Per-site enable/disable list. Matches by exact hostname (e.g. "docs.example.com"
// and "example.com" are treated as different sites).
const SiteUtils = {
  async getDisabledSites() {
    const stored = await StorageUtils.get(STORAGE_KEYS.DISABLED_SITES);
    const list = stored[STORAGE_KEYS.DISABLED_SITES];
    return Array.isArray(list) ? list : DEFAULT_VALUES.DISABLED_SITES;
  },

  async isSiteDisabled(hostname) {
    if (!hostname) return false;
    const sites = await this.getDisabledSites();
    return sites.includes(hostname);
  },

  async setSiteDisabled(hostname, disabled) {
    const sites = await this.getDisabledSites();
    const next = disabled
      ? Array.from(new Set([...sites, hostname]))
      : sites.filter(site => site !== hostname);
    await StorageUtils.set({ [STORAGE_KEYS.DISABLED_SITES]: next });
    return next;
  }
};

// One letter from any script WordGlance claims to read, Latin and otherwise.
// Named rather than inlined because the character ranges are long, and the one
// place that needs it - HeadwordUtils.normalize - is a rule about what a
// headword is rather than about letters.
const LETTER = /[a-zA-ZÀ-ɏऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ඀-෿฀-໿ༀ-࿿က-႟Ⰰ-퟿、-퟿豈-﫿︰-﹏＀-￯]/;

// A Lookup is about exactly one headword, so this is the single place that
// decides what counts as one. Both call sites depend on it and must not grow
// their own rule: the content script uses it to decide whether the trigger
// appears at all, and the background script uses it to reject a non-headword
// before issuing any request.
const HeadwordUtils = {
  // Returns the normalised headword, or '' when the text is not one.
  //
  // Case is left alone, because the tooltip shows the word as the reader selected
  // it; the background lowercases separately when it builds a key.
  //
  // Whitespace is the rejection rule. A selection containing any is a phrase, and
  // a phrase is not something a Lookup can answer.
  normalize(text) {
    if (!text || typeof text !== 'string') return '';

    // Whitespace, and the control characters that are not whitespace, are both
    // stripped. A tab or a newline is not stripped, because a reader's selection
    // can span a line break and joining the halves would invent a word.
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '').trim();
    if (!cleaned) return '';

    // Rejecting whitespace is the rule, so a 5,000-character run of a single
    // character passes it. Without a length bound that becomes a 5,000-character
    // URL to a provider, so a headword has to be short enough to plausibly be
    // one. Nothing in the bundled dictionary comes near this: its longest
    // headword is `extraterrestrials`, 17 characters, and the generator admits
    // [a-z] only, so no hyphenated compound can be one either. The longest
    // compound in a corpus dictionary is longer, but nothing close to this.
    if (cleaned.length > CONFIG.maxHeadwordLength) return '';

    // A single token, in any script. Apostrophes are part of a word - both the
    // straight and the typographic kind, because a reader selecting from a
    // typeset page gets U+2019 - as are hyphens (end-to-end) and the periods in
    // an abbreviation (U.S.).
    //
    // Whitespace is absent from this class deliberately. Allowing it here and
    // rejecting it in the length check would be the same rule written twice.
    //
    // Punctuation is safe to accept because everything downstream sets text via
    // textContent, never innerHTML.
    const singleToken = /^[\w\u00C0-\u024F\u0300-\u036F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u200c\u200d'\u2018\u2019.\-]+$/;
    if (!singleToken.test(cleaned)) return '';

    // Must contain at least one letter, so a selection of digits or punctuation
    // is not mistaken for a word.
    if (!LETTER.test(cleaned)) return '';

    return cleaned;
  }
};

// The Translation Field is suppressed when the reader has explicitly set their
// Source language to the Target language: the headword is already in the
// language they asked to read it in, so there is nothing to translate it into.
//
// Decided locally, never asked of a provider, so the answer is identical
// whichever provider is behind it and the Lookup costs nothing. Shared because
// two scripts need it - the background to issue no request, the Tooltip to show
// no Field - and two copies of one rule would eventually disagree.
function translationSuppressed(settings) {
  // 'auto' is a setting, not a language. It can never be equal to a Target
  // language, and treating it as one would suppress the Field for the reader
  // who never set a Source language at all.
  return settings.sourceLanguage !== 'auto' && settings.sourceLanguage === settings.targetLanguage;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

class LRUCache {
  constructor(maxSize = CONFIG.cacheSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Remove if exists (to reorder)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add to end
    this.cache.set(key, value);

    // Remove oldest if over limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  clear() {
    this.cache.clear();
  }

  toObject() {
    return Object.fromEntries(this.cache);
  }

  fromObject(obj) {
    Object.entries(obj).forEach(([k, v]) => this.set(k, v));
  }
}

async function fetchWithTimeout(url, options = {}, timeout = CONFIG.apiTimeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function sendMessage(message) {
  try {
    const response = await browser.runtime.sendMessage(message);
    return response;
  } catch (error) {
    console.warn('Message send error:', error);
    return { success: false, error: error.message };
  }
}

