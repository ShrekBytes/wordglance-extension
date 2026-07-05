/*
  Background Script: WordGlance Extension
  Handles API calls, cache management, settings, and message routing
*/

// State management
const settings = {
  targetLanguage: DEFAULT_VALUES.TARGET_LANGUAGE,
  sourceLanguage: DEFAULT_VALUES.SOURCE_LANGUAGE,
  darkMode: DEFAULT_VALUES.DARK_MODE
};

const caches = {
  definitions: new LRUCache(CONFIG.cacheSize),
  translations: new LRUCache(CONFIG.cacheSize)
};

// Settings management with proper boolean handling
async function loadSettings() {
  const stored = await StorageUtils.get([
    STORAGE_KEYS.TARGET_LANGUAGE,
    STORAGE_KEYS.SOURCE_LANGUAGE,
    STORAGE_KEYS.DARK_MODE
  ]);

  // Use getValue (not ||) so an explicitly stored false/0 isn't overridden by the default
  settings.targetLanguage = StorageUtils.getValue(stored, STORAGE_KEYS.TARGET_LANGUAGE, DEFAULT_VALUES.TARGET_LANGUAGE);
  settings.sourceLanguage = StorageUtils.getValue(stored, STORAGE_KEYS.SOURCE_LANGUAGE, DEFAULT_VALUES.SOURCE_LANGUAGE);
  settings.darkMode = StorageUtils.getValue(stored, STORAGE_KEYS.DARK_MODE, DEFAULT_VALUES.DARK_MODE);
}

const settingsReady = loadSettings().catch(e => {
  console.warn('Settings load error:', e);
});

// Cache management with debounced saving
async function loadCaches() {
  try {
    const [defCache, transCache] = await Promise.all([
      StorageUtils.get(STORAGE_KEYS.CACHE_DEFINITIONS),
      StorageUtils.get(STORAGE_KEYS.CACHE_TRANSLATIONS)
    ]);

    if (defCache[STORAGE_KEYS.CACHE_DEFINITIONS]) {
      const defs = JSON.parse(defCache[STORAGE_KEYS.CACHE_DEFINITIONS]);
      caches.definitions.fromObject(defs);
    }

    if (transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]) {
      const trans = JSON.parse(transCache[STORAGE_KEYS.CACHE_TRANSLATIONS]);
      caches.translations.fromObject(trans);
    }
  } catch (e) {
    console.warn('Cache loading error:', e);
  }
}

const cachesReady = loadCaches();

// Debounced cache saving to reduce storage writes
const saveCaches = debounce(async () => {
  try {
    await StorageUtils.set({
      [STORAGE_KEYS.CACHE_DEFINITIONS]: JSON.stringify(caches.definitions.toObject()),
      [STORAGE_KEYS.CACHE_TRANSLATIONS]: JSON.stringify(caches.translations.toObject())
    });
  } catch (e) {
    console.warn('Cache save error:', e);
  }
}, CONFIG.cacheSaveDelay);

async function clearAllCaches() {
  caches.definitions.clear();
  caches.translations.clear();
  await StorageUtils.set({
    [STORAGE_KEYS.CACHE_DEFINITIONS]: '{}',
    [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
  });
}

// API functions
async function fetchDefinition(word) {
  const key = TextUtils.sanitize(word)?.toLowerCase();
  if (!key) throw new Error(ERROR_MESSAGES.INVALID_WORD);

  const cached = caches.definitions.get(key);
  if (cached) return cached;

  let res;
  try {
    res = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`
    );
  } catch (e) {
    // The fetch itself failed - offline, DNS, timed out, etc. This is a genuine connection problem.
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  // The API responds with 404 when the word simply has no entry - that's not a connection
  // problem, so it gets its own accurate message instead of the generic network error.
  if (res.status === 404) {
    throw new Error(ERROR_MESSAGES.NO_DEFINITION);
  }
  if (!res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  try {
    const data = await res.json();

    // Extract definitions, synonyms, antonyms, and pronunciation audio
    const defs = [];
    const syns = new Set();
    const ants = new Set();
    let audio = '';

    (data || []).forEach(entry => {
      if (!audio) {
        const withAudio = (entry.phonetics || []).find(p => p.audio);
        if (withAudio) {
          // Some entries return protocol-relative URLs (e.g. "//...")
          audio = withAudio.audio.startsWith('//') ? `https:${withAudio.audio}` : withAudio.audio;
        }
      }

      (entry.meanings || []).forEach(m => {
        // Collect synonyms and antonyms at meaning level
        (m.synonyms || []).forEach(s => syns.add(s));
        (m.antonyms || []).forEach(a => ants.add(a));

        // Collect definitions
        (m.definitions || []).forEach(d => {
          if (d.definition) {
            defs.push({
              definition: d.definition,
              partOfSpeech: m.partOfSpeech || '',
              example: d.example || ''
            });
          }
          // Collect synonyms and antonyms at definition level
          (d.synonyms || []).forEach(s => syns.add(s));
          (d.antonyms || []).forEach(a => ants.add(a));
        });
      });
    });

    const result = {
      defs: defs.slice(0, CONFIG.maxDefinitions),
      synonyms: Array.from(syns).slice(0, CONFIG.maxSynonyms),
      antonyms: Array.from(ants).slice(0, CONFIG.maxAntonyms),
      audio
    };

    // Cache result and trigger debounced save
    caches.definitions.set(key, result);
    saveCaches();
    return result;
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
}

async function fetchTranslation(text) {
  const cleanText = TextUtils.sanitize(text);
  if (!cleanText) throw new Error(ERROR_MESSAGES.INVALID_TEXT);

  const key = `${cleanText}::${settings.sourceLanguage}::${settings.targetLanguage}`;
  const cached = caches.translations.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    dl: settings.targetLanguage,
    text: cleanText
  });
  if (settings.sourceLanguage !== 'auto') {
    params.set('sl', settings.sourceLanguage);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      `https://translation-1e79fb3f3adb.herokuapp.com/translate?${params}`
    );
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  if (!res.ok) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }

  try {
    const data = await res.json();

    // Extract translations
    const translations = [];
    if (data?.['destination-text']) {
      translations.push(data['destination-text']);

      // Add alternative translations
      const allTranslations = data.translations?.['all-translations'] || [];
      for (const group of allTranslations) {
        if (Array.isArray(group) && group[0] &&
            group[0] !== data['destination-text'] &&
            !translations.includes(group[0])) {
          translations.push(group[0]);
          if (translations.length >= CONFIG.maxTranslations) break;
        }
      }

      // Add possible translations if we need more
      if (translations.length < CONFIG.maxTranslations) {
        const extra = (data.translations?.['possible-translations'] || [])
          .filter(t => t && !translations.includes(t));
        translations.push(...extra.slice(0, CONFIG.maxTranslations - translations.length));
      }
    }

    const result = {
      translations: translations.slice(0, CONFIG.maxTranslations)
    };

    // Cache result and trigger debounced save
    caches.translations.set(key, result);
    saveCaches();
    return result;
  } catch (e) {
    throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
  }
}

// Message handling
browser.runtime.onMessage.addListener(async (msg) => {
  try {
    await settingsReady;

    switch (msg.type) {
      case MESSAGE_TYPES.GET_SETTINGS:
        return {
          success: true,
          data: {
            targetLanguage: settings.targetLanguage,
            sourceLanguage: settings.sourceLanguage,
            darkMode: settings.darkMode
          }
        };

      case MESSAGE_TYPES.GET_DEFINITION: {
        if (settings.sourceLanguage !== 'en' && settings.sourceLanguage !== 'auto') {
          return {
            success: false,
            error: ERROR_MESSAGES.SOURCE_NOT_ENGLISH
          };
        }
        const defResult = await fetchDefinition(msg.word);
        return { success: true, data: defResult };
      }

      case MESSAGE_TYPES.GET_TRANSLATION: {
        const transResult = await fetchTranslation(msg.text);
        return { success: true, data: transResult };
      }

      case MESSAGE_TYPES.CLEAR_CACHE:
        await clearAllCaches();
        return { success: true };

      case MESSAGE_TYPES.CLEAR_TRANSLATION_CACHE:
        caches.translations.clear();
        await StorageUtils.set({
          [STORAGE_KEYS.CACHE_TRANSLATIONS]: '{}'
        });
        return { success: true };

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
});

// Storage change listener with proper boolean handling
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes[STORAGE_KEYS.TARGET_LANGUAGE]) {
    settings.targetLanguage = changes[STORAGE_KEYS.TARGET_LANGUAGE].newValue ?? DEFAULT_VALUES.TARGET_LANGUAGE;
  }

  if (changes[STORAGE_KEYS.SOURCE_LANGUAGE]) {
    settings.sourceLanguage = changes[STORAGE_KEYS.SOURCE_LANGUAGE].newValue ?? DEFAULT_VALUES.SOURCE_LANGUAGE;
  }

  if (changes[STORAGE_KEYS.DARK_MODE]) {
    // Nullish coalescing (not ||) so an explicit `false` isn't replaced by the default
    settings.darkMode = changes[STORAGE_KEYS.DARK_MODE].newValue ?? DEFAULT_VALUES.DARK_MODE;
  }
});

// Clear caches on browser startup to ensure fresh data.
// Waits for the initial cache load first, otherwise a load that resolves after
// this runs would repopulate the in-memory cache with the data we just cleared.
browser.runtime.onStartup.addListener(async () => {
  await cachesReady;
  await clearAllCaches();
});
